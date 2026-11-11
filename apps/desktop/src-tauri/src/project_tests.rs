//! Tests for the project filesystem commands.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use tempfile::TempDir;

/// A temporary directory that cleans itself up.
fn temp_dir() -> TempDir {
    tempfile::tempdir().expect("cannot create a temporary directory")
}

fn write(root: &PathBuf, relative: &str, contents: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("cannot create a folder");
    }
    fs::write(&path, contents).expect("cannot write a file");
}

#[test]
fn collects_text_files_with_relative_paths() {
    let root = temp_dir();
    write(&root.path().to_path_buf(), "content/intro.md", "# Intro");
    write(&root.path().to_path_buf(), "styles/main.css", "body {}");

    let result = crate::testing::open_project(root.path().to_string_lossy().to_string())
        .expect("open_project failed");

    let paths: Vec<&str> = result.files.iter().map(|file| file.path.as_str()).collect();
    assert!(paths.contains(&"content/intro.md"), "got {paths:?}");
    assert!(paths.contains(&"styles/main.css"), "got {paths:?}");
}

#[test]
fn skips_hidden_and_vendor_directories() {
    let root = temp_dir();
    write(&root.path().to_path_buf(), "content/intro.md", "# Intro");
    write(&root.path().to_path_buf(), "node_modules/pkg/readme.md", "vendor");
    write(&root.path().to_path_buf(), ".git/config", "[core]");

    let result = crate::testing::open_project(root.path().to_string_lossy().to_string())
        .expect("open_project failed");

    let paths: Vec<&str> = result.files.iter().map(|file| file.path.as_str()).collect();
    assert!(paths.contains(&"content/intro.md"), "got {paths:?}");
    assert!(!paths.iter().any(|path| path.contains("node_modules")), "got {paths:?}");
    assert!(!paths.iter().any(|path| path.contains(".git")), "got {paths:?}");
}

#[test]
fn reads_project_json_when_present() {
    let root = temp_dir();
    write(
        &root.path().to_path_buf(),
        "project.json",
        r#"{"schemaVersion":1,"title":"Test"}"#,
    );

    let result = crate::testing::open_project(root.path().to_string_lossy().to_string())
        .expect("open_project failed");

    let project = result.project.expect("expected a project");
    assert_eq!(project["title"], "Test");
}

#[test]
fn tolerates_a_folder_without_project_json() {
    let root = temp_dir();
    write(&root.path().to_path_buf(), "content/intro.md", "# Intro");

    let result = crate::testing::open_project(root.path().to_string_lossy().to_string())
        .expect("open_project failed");

    assert!(result.project.is_none());
}

#[test]
fn rejects_a_path_that_is_not_a_folder() {
    let root = temp_dir();
    let file = root.path().join("not-a-folder.txt");
    fs::write(&file, "x").expect("cannot write a file");

    let result = crate::testing::open_project(file.to_string_lossy().to_string());

    assert!(result.is_err());
}

#[test]
fn writes_files_and_project_json() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();

    let mut files = std::collections::BTreeMap::new();
    files.insert("content/intro.md".to_string(), "# Intro".to_string());
    files.insert("styles/main.css".to_string(), "body {}".to_string());

    let project = serde_json::json!({
        "schemaVersion": 1,
        "title": "Written",
    });

    crate::testing::save_project(
        root_path.to_string_lossy().to_string(),
        project,
        files,
    )
    .expect("save_project failed");

    assert_eq!(
        fs::read_to_string(root_path.join("content/intro.md")).unwrap(),
        "# Intro"
    );
    assert!(root_path.join("styles/main.css").is_file());
    assert!(root_path.join("project.json").is_file());
}

#[test]
fn refuses_to_write_outside_the_project() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();

    let mut files = std::collections::BTreeMap::new();
    files.insert("../escaped.md".to_string(), "nope".to_string());

    let result = crate::testing::save_project(
        root_path.to_string_lossy().to_string(),
        serde_json::json!({ "schemaVersion": 1, "title": "x" }),
        files,
    );

    assert!(result.is_err(), "expected the write to be refused");
    assert!(!root_path.parent().unwrap().join("escaped.md").exists());
}

#[test]
fn collects_the_fonts_a_project_asks_for() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();
    write(&root_path, "fonts/inter-400.woff2", "font bytes");

    let binaries = crate::testing::collect_project_binaries(
        root_path.to_string_lossy().to_string(),
        vec!["fonts/inter-400.woff2".to_string()],
        "assets".to_string(),
    )
    .expect("collect_project_binaries failed");

    assert_eq!(binaries.fonts.len(), 1);
    assert_eq!(binaries.fonts[0].path, "fonts/inter-400.woff2");
    assert_eq!(binaries.fonts[0].mime_type, "font/woff2");
    assert_eq!(
        binaries.fonts[0].base64,
        base64::engine::general_purpose::STANDARD.encode("font bytes")
    );
    assert!(binaries.assets.is_empty());
}

#[test]
fn collects_the_assets_folder_as_assets() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();
    write(&root_path, "assets/diagram.svg", "<svg/>");
    write(&root_path, "fonts/inter-400.woff2", "font bytes");

    let binaries = crate::testing::collect_project_binaries(
        root_path.to_string_lossy().to_string(),
        vec!["fonts/inter-400.woff2".to_string()],
        "assets".to_string(),
    )
    .expect("collect_project_binaries failed");

    assert_eq!(binaries.fonts.len(), 1);
    assert_eq!(binaries.assets.len(), 1);
    assert_eq!(binaries.assets[0].path, "assets/diagram.svg");
    assert_eq!(binaries.assets[0].mime_type, "image/svg+xml");
}

#[test]
fn skips_a_font_that_is_not_on_disk() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();

    let binaries = crate::testing::collect_project_binaries(
        root_path.to_string_lossy().to_string(),
        vec!["fonts/missing.woff2".to_string()],
        "assets".to_string(),
    )
    .expect("collect_project_binaries failed");

    assert!(binaries.fonts.is_empty());
}

#[test]
fn refuses_to_read_a_font_outside_the_project() {
    let root = temp_dir();
    let root_path = root.path().to_path_buf();

    let result = crate::testing::collect_project_binaries(
        root_path.to_string_lossy().to_string(),
        vec!["../escaped.woff2".to_string()],
        "assets".to_string(),
    );

    assert!(result.is_err(), "expected the read to be refused");
}

#[test]
fn creates_a_project_with_text_and_binary_files() {
    let root = temp_dir();
    let root_path = root.path().join("new-project");

    let files = vec![
        crate::project::ProjectFileToWrite {
            path: "content/intro.md".to_string(),
            text: Some("# Intro".to_string()),
            base64: None,
        },
        crate::project::ProjectFileToWrite {
            path: "styles/main.css".to_string(),
            text: Some("body {}".to_string()),
            base64: None,
        },
        crate::project::ProjectFileToWrite {
            path: "fonts/inter-400.woff2".to_string(),
            text: None,
            base64: Some(base64::engine::general_purpose::STANDARD.encode("font bytes")),
        },
    ];

    crate::testing::create_project(
        root_path.to_string_lossy().to_string(),
        serde_json::json!({ "schemaVersion": 2, "title": "New" }),
        files,
    )
    .expect("create_project failed");

    assert_eq!(
        fs::read_to_string(root_path.join("content/intro.md")).unwrap(),
        "# Intro"
    );
    assert!(root_path.join("styles/main.css").is_file());
    assert_eq!(
        fs::read(root_path.join("fonts/inter-400.woff2")).unwrap(),
        b"font bytes"
    );
    assert!(root_path.join("project.json").is_file());
}

#[test]
fn a_created_project_can_be_opened_again() {
    let root = temp_dir();
    let root_path = root.path().join("new-project");

    let files = vec![crate::project::ProjectFileToWrite {
        path: "content/intro.md".to_string(),
        text: Some("# Intro".to_string()),
        base64: None,
    }];

    crate::testing::create_project(
        root_path.to_string_lossy().to_string(),
        serde_json::json!({ "schemaVersion": 2, "title": "New" }),
        files,
    )
    .expect("create_project failed");

    let result = crate::testing::open_project(root_path.to_string_lossy().to_string())
        .expect("open_project failed");

    let project = result.project.expect("expected a project");
    assert_eq!(project["title"], "New");
    assert_eq!(project["schemaVersion"], 2);

    let paths: Vec<&str> = result.files.iter().map(|file| file.path.as_str()).collect();
    assert!(paths.contains(&"content/intro.md"), "got {paths:?}");
}

#[test]
fn refuses_to_create_a_file_outside_the_project() {
    let root = temp_dir();
    let root_path = root.path().join("new-project");

    let files = vec![crate::project::ProjectFileToWrite {
        path: "../escaped.md".to_string(),
        text: Some("nope".to_string()),
        base64: None,
    }];

    let result = crate::testing::create_project(
        root_path.to_string_lossy().to_string(),
        serde_json::json!({ "schemaVersion": 2, "title": "New" }),
        files,
    );

    assert!(result.is_err(), "expected the write to be refused");
    assert!(!root.path().join("escaped.md").exists());
}
