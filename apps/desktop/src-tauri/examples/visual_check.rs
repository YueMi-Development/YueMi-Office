//! Renders the reference document and compares the pages with the baselines.
//!
//!     cargo run --example visual_check -- write
//!     cargo run --example visual_check -- check
//!
//! The pages are compared, not the PDF bytes. The bytes carry the metadata
//! of the machine that wrote them, while the rendered pages are the same
//! document everywhere.
//!
//! Typst rasterises with its own renderer rather than with the system's,
//! so the pages of the same document are the same on every operating
//! system. That is what makes a committed baseline worth having.

use std::fs;
use std::path::{Path, PathBuf};

use app_lib::testing::{load_project_folder, render_project_pages};
use base64::Engine;

/// The share of pixels that may differ before a page counts as different.
///
/// Antialiasing differs slightly between the platforms' rasterisers.
const TOLERANCE: f64 = 0.002;

/// The fixture folder, relative to the crate root.
const FIXTURE: &str = "tests/fixtures/reference";

/// The baselines, relative to the crate root.
const BASELINE: &str = "tests/visual/baseline/reference";

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "check".to_string());

    let request = match load_project_folder(&root.join(FIXTURE)) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("Cannot read the reference document: {error}");
            std::process::exit(1);
        }
    };

    let pages = match render_project_pages(&request) {
        Ok(pages) => pages,
        Err(error) => {
            eprintln!("The reference document did not render: {error}");
            std::process::exit(1);
        }
    };

    for warning in &pages.warnings {
        eprintln!("warning: {}", warning.message);
    }

    let written = root.join("target/visual-check");
    if let Err(error) = fs::create_dir_all(&written) {
        eprintln!("Cannot create {}: {error}", written.display());
        std::process::exit(1);
    }

    let mut rendered = Vec::new();
    for page in &pages.pages {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&page.png_base64)
            .unwrap_or_else(|error| {
                eprintln!("Cannot decode the page {}: {error}", page.index);
                std::process::exit(1);
            });
        let path = written.join(format!("page-{}.png", page.index + 1));
        if let Err(error) = fs::write(&path, &bytes) {
            eprintln!("Cannot write {}: {error}", path.display());
            std::process::exit(1);
        }
        rendered.push(bytes);
    }

    println!("{} page(s) rendered.", rendered.len());

    match mode.as_str() {
        "write" => write_baselines(&root, &rendered),
        "check" => check_baselines(&root, &rendered),
        other => {
            eprintln!("Unknown mode: {other}. Use 'write' or 'check'.");
            std::process::exit(2);
        }
    }
}

/// Writes the rendered pages as the new baselines.
fn write_baselines(root: &Path, rendered: &[Vec<u8>]) {
    let folder = root.join(BASELINE);

    if let Err(error) = fs::create_dir_all(&folder) {
        eprintln!("Cannot create {}: {error}", folder.display());
        std::process::exit(1);
    }

    for (index, bytes) in rendered.iter().enumerate() {
        let path = folder.join(format!("page-{}.png", index + 1));
        if let Err(error) = fs::write(&path, bytes) {
            eprintln!("Cannot write {}: {error}", path.display());
            std::process::exit(1);
        }
        println!("wrote {}", path.display());
    }

    let manifest = serde_json::json!({
        "pageCount": rendered.len(),
        "pages": (1..=rendered.len())
            .map(|number| format!("page-{number}.png"))
            .collect::<Vec<_>>(),
    });
    let manifest_path = folder.join("manifest.json");
    let text = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    if let Err(error) = fs::write(&manifest_path, format!("{text}\n")) {
        eprintln!("Cannot write {}: {error}", manifest_path.display());
        std::process::exit(1);
    }

    println!("The baselines were written.");
}

/// Compares the rendered pages with the baselines.
fn check_baselines(root: &Path, rendered: &[Vec<u8>]) {
    let folder = root.join(BASELINE);
    let mut problems = Vec::new();

    let expected = baseline_pages(&folder);

    if expected.len() != rendered.len() {
        problems.push(format!(
            "the document has {} page(s), the baseline has {}",
            rendered.len(),
            expected.len()
        ));
    }

    for (index, bytes) in rendered.iter().enumerate() {
        let Some(baseline) = expected.get(index) else {
            continue;
        };

        match compare(baseline.as_slice(), bytes) {
            Ok(difference) if difference <= TOLERANCE => {}
            Ok(difference) => problems.push(format!(
                "page {} differs from the baseline by {:.4} of its pixels",
                index + 1,
                difference
            )),
            Err(error) => problems.push(format!("page {}: {error}", index + 1)),
        }
    }

    if problems.is_empty() {
        println!("The pages match the baselines.");
        return;
    }

    eprintln!("The pages do not match the baselines:");
    for problem in &problems {
        eprintln!("  {problem}");
    }
    eprintln!();
    eprintln!("If the change is intended, write the new baselines with:");
    eprintln!("  cargo run --example visual_check -- write");
    std::process::exit(1);
}

/// The baseline pages, in order.
fn baseline_pages(folder: &Path) -> Vec<Vec<u8>> {
    let mut paths: Vec<PathBuf> = match fs::read_dir(folder) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value == "png")
            })
            .collect(),
        Err(_) => return Vec::new(),
    };

    // The pages are ordered by the number in the name, because the names
    // sorted as text would put page 10 before page 2.
    paths.sort_by_key(|path| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| stem.rsplit('-').next())
            .and_then(|number| number.parse::<u32>().ok())
            .unwrap_or(0)
    });

    paths
        .iter()
        .filter_map(|path| fs::read(path).ok())
        .collect()
}

/// The share of the pixels that differ between two images.
///
/// The images have to be the same size. A page that is a different size is
/// a different document, and there is nothing to compare.
fn compare(expected: &[u8], actual: &[u8]) -> Result<f64, String> {
    let expected = decode(expected)?;
    let actual = decode(actual)?;

    if expected.width != actual.width || expected.height != actual.height {
        return Err(format!(
            "the baseline is {}x{} and the render is {}x{}",
            expected.width, expected.height, actual.width, actual.height
        ));
    }

    let total = expected.width as usize * expected.height as usize;

    if total == 0 {
        return Ok(0.0);
    }

    let mut different = 0usize;

    for index in 0..total {
        if expected.pixels[index] != actual.pixels[index] {
            different += 1;
        }
    }

    Ok(different as f64 / total as f64)
}

/// A decoded image, as eight-bit greyscale pixels.
struct Image {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

/// The width the decoder read from the header.
fn info_width(reader: &png::Reader<std::io::Cursor<&[u8]>>) -> u32 {
    reader.info().width
}

/// The height the decoder read from the header.
fn info_height(reader: &png::Reader<std::io::Cursor<&[u8]>>) -> u32 {
    reader.info().height
}

/// Decodes a PNG into greyscale pixels.
///
/// The pages are white paper with dark text on it, so the grey of a pixel
/// is what tells them apart, and comparing three channels would only make
/// the comparison slower.
fn decode(bytes: &[u8]) -> Result<Image, String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("cannot read the image: {error}"))?;

    // The size the decoder wants is not known until the header is read, so
    // the buffer is sized from the dimensions when the decoder does not say.
    let size = reader
        .output_buffer_size()
        .unwrap_or((info_width(&reader) * info_height(&reader) * 4 + 8) as usize);
    let mut buffer = vec![0u8; size];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|error| format!("cannot decode the image: {error}"))?;

    let width = info.width;
    let height = info.height;

    if info.color_type == png::ColorType::Indexed {
        return Err("the image has a palette, which the comparison cannot read".to_string());
    }

    let channels = info.color_type.samples();
    let mut pixels = Vec::with_capacity((width * height) as usize);

    for index in 0..(width * height) as usize {
        let offset = index * channels as usize;

        let value = match info.color_type {
            png::ColorType::Grayscale | png::ColorType::GrayscaleAlpha => buffer[offset],
            png::ColorType::Rgb | png::ColorType::Rgba => {
                let red = buffer[offset] as u32;
                let green = buffer[offset + 1] as u32;
                let blue = buffer[offset + 2] as u32;
                ((red * 299 + green * 587 + blue * 114) / 1000) as u8
            }
            png::ColorType::Indexed => unreachable!("the palette case returned above"),
        };

        pixels.push(value);
    }

    Ok(Image {
        width,
        height,
        pixels,
    })
}
