//! Writes the fixture the app and the renderer share.
//!
//! The fixture is the contract between the two sides, so it is generated
//! from the renderer's own code. Run it from the crate's directory:
//!
//! ```text
//! cargo run --example write_assistant_fixture
//! ```

use std::path::PathBuf;

fn main() {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("..");
    path.push("..");
    path.push("..");
    path.push("packages");
    path.push("protocol");
    path.push("src");
    path.push("fixtures");
    path.push("assistant.json");

    match app_lib::testing::write_assistant_fixture(&path) {
        Ok(()) => println!("Wrote '{}'.", path.display()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
