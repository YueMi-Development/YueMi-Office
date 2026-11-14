//! Reading a project folder from the disk.
//!
//! The renderer is given everything it needs in a request, so that a
//! document can be rendered from files that never touch the disk. A
//! folder on the disk still has to be turned into such a request, and
//! that is what this module does.
//!
//! It is used by the visual check and by the test of the reference
//! document, which are the two places that render a project folder
//! rather than a project that was handed to them.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;

use crate::render::{Project, ProjectAsset, ProjectFile, ProjectFont, RenderRequest};

/// Reads a project folder into a render request.
///
/// The folder holds a `project.json`, the content files it names, the
/// theme it names, the fonts it lists and the assets in its assets
/// directory. Everything that is read is read into the request, so the
/// folder is not needed after this.
pub fn load_project_folder(root: &Path) -> Result<RenderRequest, String> {
    let project_text = fs::read_to_string(root.join("project.json"))
        .map_err(|error| format!("Cannot read project.json: {error}"))?;
    let project: Project = serde_json::from_str(&project_text)
        .map_err(|error| format!("project.json is not valid JSON: {error}"))?;

    let mut files = Vec::new();
    collect_text(root, root, &mut files)?;

    let mut fonts = Vec::new();
    for path in project.fonts.clone().unwrap_or_default() {
        let bytes =
            fs::read(root.join(&path)).map_err(|error| format!("Cannot read {path}: {error}"))?;
        fonts.push(ProjectFont {
            path: path.clone(),
            base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            mime_type: "font/woff2".to_string(),
        });
    }

    let mut assets = Vec::new();
    let asset_folder = root.join(&project.assets_dir);
    if asset_folder.is_dir() {
        let mut paths = Vec::new();
        collect_binary(&asset_folder, &mut paths);
        for path in paths {
            let relative = relative_to(root, &path);
            let bytes =
                fs::read(&path).map_err(|error| format!("Cannot read {relative}: {error}"))?;
            assets.push(ProjectAsset {
                path: relative,
                base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                mime_type: mime_type_of(&path),
            });
        }
    }

    Ok(RenderRequest {
        project,
        files,
        assets,
        fonts,
    })
}

/// The path of a file relative to the root of the project.
fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// The MIME type of an asset, from its extension.
fn mime_type_of(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();

    match extension.as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Collects the text files of a folder, recursively.
fn collect_text(root: &Path, directory: &Path, files: &mut Vec<ProjectFile>) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Cannot read {}: {error}", directory.display()))?;

    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    paths.sort();

    for path in paths {
        if path.is_dir() {
            collect_text(root, &path, files)?;
            continue;
        }

        let is_text = matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("typ") | Some("json") | Some("txt")
        );

        if !is_text {
            continue;
        }

        let relative = relative_to(root, &path);
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("Cannot read {relative}: {error}"))?;
        files.push(ProjectFile {
            path: relative,
            text,
        });
    }

    Ok(())
}

/// Collects the binary files of a folder, recursively.
fn collect_binary(directory: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    let mut found: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    found.sort();

    for path in found {
        if path.is_dir() {
            collect_binary(&path, paths);
            continue;
        }

        if matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("svg") | Some("png") | Some("jpg") | Some("jpeg") | Some("webp") | Some("pdf")
        ) {
            paths.push(path);
        }
    }
}
