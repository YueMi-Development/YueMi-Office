//! The reference document renders to the pages the baselines hold.
//!
//! The visual check compares the rendered pages with the committed
//! baselines, pixel by pixel. This test is the cheaper half of that: it
//! checks that the reference document still renders to two pages, with no
//! warning about a missing asset, so that a document that stopped
//! rendering is caught by the ordinary test run rather than only by the
//! visual job.

use std::fs;
use std::path::PathBuf;

use app_lib::testing::{load_project_folder, render_project_pages};

/// The fixture folder, relative to the crate root.
const FIXTURE: &str = "tests/fixtures/reference";

/// The baselines, relative to the crate root.
const BASELINE: &str = "tests/visual/baseline/reference";

/// The crate root.
fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn the_reference_document_renders_to_the_pages_of_the_baseline() {
    let request = load_project_folder(&crate_root().join(FIXTURE))
        .expect("the reference folder should be a project");

    let pages = render_project_pages(&request).expect("the reference document should render");

    assert_eq!(
        pages.pages.len(),
        2,
        "the reference document should be two pages, like the baseline"
    );

    for warning in &pages.warnings {
        assert!(
            warning.code != "asset.missing",
            "the reference document should find its assets: {}",
            warning.message
        );
    }
}

#[test]
fn the_baselines_are_the_pages_of_the_reference_document() {
    // The manifest says which pages the baseline holds. A baseline that
    // does not match the manifest is a baseline that the visual check
    // would compare against the wrong number of pages.
    let folder = crate_root().join(BASELINE);
    let manifest_path = folder.join("manifest.json");

    let text = fs::read_to_string(&manifest_path).expect("the manifest should read");
    let manifest: serde_json::Value =
        serde_json::from_str(&text).expect("the manifest should be valid JSON");

    assert_eq!(
        manifest.get("pageCount").and_then(|value| value.as_u64()),
        Some(2),
        "the manifest should hold two pages"
    );

    let pages = manifest
        .get("pages")
        .and_then(|value| value.as_array())
        .expect("the manifest should hold the names of the pages");

    assert_eq!(pages.len(), 2);

    for page in pages {
        let name = page.as_str().expect("a page name should be text");
        let path = folder.join(name);

        assert!(
            path.exists(),
            "the baseline page '{name}' should be in the repository"
        );
    }
}
