//! Filesystem commands exposed to the webview.
//!
//! The webview never gets broad filesystem access: it asks for a project
//! folder, and every path the commands touch is resolved inside it.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// A text file found in a project folder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredFile {
    /// Path relative to the project root, with forward slashes.
    pub path: String,
    pub text: String,
}

/// The result of reading a project folder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectResult {
    /// The parsed `project.json`, or null when the folder has none.
    pub project: Option<serde_json::Value>,
    /// Every text file in the folder.
    pub files: Vec<DiscoveredFile>,
}

/// Extensions treated as project text files.
const TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "css", "json", "txt", "yaml", "yml"];

/// Directory names that are never scanned.
const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    ".obsidian",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".venv",
];

/// Turns a relative path into an absolute path inside the project root.
///
/// Returns an error if the result would escape the root, which is what keeps
/// a project's files inside the folder the user opened.
fn resolve_in_project(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = root.join(relative);

    // Reject absolute paths and parent traversal before touching the disk.
    let normalized_relative = Path::new(relative);
    for component in normalized_relative.components() {
        match component {
            Component::ParentDir => {
                return Err(format!("Path escapes the project folder: {relative}"))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path must be relative to the project: {relative}"))
            }
            _ => {}
        }
    }

    // Confirm the resolved path really is inside the root. The file itself
    // may not exist yet, so the closest existing ancestor is checked instead.
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Cannot open project folder: {error}"))?;

    let mut existing = candidate.as_path();
    while !existing.exists() {
        match existing.parent() {
            Some(parent) => existing = parent,
            None => break,
        }
    }

    let canonical_existing = fs::canonicalize(existing)
        .map_err(|error| format!("Cannot resolve {relative}: {error}"))?;

    if !canonical_existing.starts_with(&canonical_root) {
        return Err(format!("Path escapes the project folder: {relative}"));
    }

    Ok(candidate)
}

/// Converts a path into the forward-slash form used inside project files.
fn to_relative_string(path: &Path, root: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// Whether a file looks like a project text file.
fn is_text_file(path: &Path) -> bool {
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => {
            let lowered = extension.to_ascii_lowercase();
            TEXT_EXTENSIONS.contains(&lowered.as_str())
        }
        None => false,
    }
}

/// Recursively collects the text files in a folder.
fn collect_text_files(root: &Path, directory: &Path, files: &mut Vec<DiscoveredFile>) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut paths: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|e| e.path())).collect();
    paths.sort();

    for path in paths {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();

        if path.is_dir() {
            if SKIPPED_DIRECTORIES.contains(&name) || name.starts_with('.') {
                continue;
            }
            collect_text_files(root, &path, files);
        } else if is_text_file(&path) {
            if let Ok(text) = fs::read_to_string(&path) {
                files.push(DiscoveredFile {
                    path: to_relative_string(&path, root),
                    text,
                });
            }
        }
    }
}

/// Reads a project folder: its `project.json` and its text files.
pub fn open_project(root_path: String) -> Result<OpenProjectResult, String> {
    let root = PathBuf::from(&root_path);

    if !root.is_dir() {
        return Err(format!("Not a folder: {root_path}"));
    }

    let project_path = root.join("project.json");
    let project = if project_path.is_file() {
        let text = fs::read_to_string(&project_path)
            .map_err(|error| format!("Cannot read project.json: {error}"))?;
        Some(
            serde_json::from_str(&text)
                .map_err(|error| format!("project.json is not valid JSON: {error}"))?,
        )
    } else {
        None
    };

    let mut files = Vec::new();
    collect_text_files(&root, &root, &mut files);

    Ok(OpenProjectResult { project, files })
}

/// Writes a project's files back to disk.
///
/// Files that were deleted in the app are removed from disk too, so the
/// folder keeps matching what the user sees.
pub fn save_project(
    root_path: String,
    project: serde_json::Value,
    files: BTreeMap<String, String>,
) -> Result<(), String> {
    let root = PathBuf::from(&root_path);

    if !root.is_dir() {
        return Err(format!("Not a folder: {root_path}"));
    }

    for (relative, text) in &files {
        let path = resolve_in_project(&root, relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create folder for {relative}: {error}"))?;
        }
        fs::write(&path, text).map_err(|error| format!("Cannot write {relative}: {error}"))?;
    }

    let project_path = root.join("project.json");
    let serialized = serde_json::to_string_pretty(&project)
        .map_err(|error| format!("Cannot serialize project: {error}"))?;
    fs::write(&project_path, format!("{serialized}\n"))
        .map_err(|error| format!("Cannot write project.json: {error}"))?;

    Ok(())
}

/// Writes one file inside the project.
pub fn write_project_file(root_path: String, path: String, text: String) -> Result<(), String> {
    let root = PathBuf::from(&root_path);
    let target = resolve_in_project(&root, &path)?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create folder for {path}: {error}"))?;
    }

    fs::write(&target, text).map_err(|error| format!("Cannot write {path}: {error}"))
}

/// Writes a text file the user chose in a save dialog.
pub fn export_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create folder: {error}"))?;
    }
    fs::write(&path, contents).map_err(|error| format!("Cannot write {path}: {error}"))
}

/// Writes a binary file the user chose in a save dialog.
pub fn export_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create folder: {error}"))?;
    }
    fs::write(&path, contents).map_err(|error| format!("Cannot write {path}: {error}"))
}

/// Reads a file as bytes, used to load assets into a render request.
pub fn read_binary_file(root_path: String, path: String) -> Result<Vec<u8>, String> {
    let root = PathBuf::from(&root_path);
    let target = resolve_in_project(&root, &path)?;
    fs::read(&target).map_err(|error| format!("Cannot read {path}: {error}"))
}

// The command wrappers the webview calls. The logic lives in the plain
// functions above so it can be tested without a Tauri runtime.

/// Reads a project folder: its `project.json` and its text files.
#[tauri::command]
pub fn command_open_project(root_path: String) -> Result<OpenProjectResult, String> {
    open_project(root_path)
}

/// Writes a project's files back to disk.
#[tauri::command]
pub fn command_save_project(
    root_path: String,
    project: serde_json::Value,
    files: BTreeMap<String, String>,
) -> Result<(), String> {
    save_project(root_path, project, files)
}

/// Writes one file inside the project.
#[tauri::command]
pub fn command_write_project_file(
    root_path: String,
    path: String,
    text: String,
) -> Result<(), String> {
    write_project_file(root_path, path, text)
}

/// Writes a text file the user chose in a save dialog.
#[tauri::command]
pub fn command_export_text_file(path: String, contents: String) -> Result<(), String> {
    export_text_file(path, contents)
}

/// Writes a binary file the user chose in a save dialog.
#[tauri::command]
pub fn command_export_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    export_binary_file(path, contents)
}

/// Reads a file as bytes, used to load assets into a render request.
#[tauri::command]
pub fn command_read_binary_file(root_path: String, path: String) -> Result<Vec<u8>, String> {
    read_binary_file(root_path, path)
}
