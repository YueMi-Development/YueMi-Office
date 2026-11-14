//! Tests for the Typst renderer.

use crate::testing::{
    OutlineEntry, PageConfig, Project, ProjectFile, ProjectFont, RenderRequest, render_project,
    render_project_outline, render_project_pages,
};
use base64::Engine;
use typst::foundations::Bytes;
use typst::text::{Font, FontBook, FontVariant};

/// Builds a request for a document with the given content files.
fn request(files: &[(&str, &str)], content: &[&str]) -> RenderRequest {
    RenderRequest {
        project: Project {
            schema_version: 3,
            title: "Test document".to_string(),
            language: "en".to_string(),
            content: content.iter().map(|path| path.to_string()).collect(),
            theme: None,
            fonts: None,
            assets_dir: "assets".to_string(),
            page: PageConfig::default(),
            pdf: Default::default(),
        },
        files: files
            .iter()
            .map(|(path, text)| ProjectFile {
                path: path.to_string(),
                text: text.to_string(),
            })
            .collect(),
        assets: Vec::new(),
        fonts: Vec::new(),
    }
}

/// Builds a request whose project has a theme.
fn themed_request(files: &[(&str, &str)], content: &[&str], theme: &str) -> RenderRequest {
    let mut request = request(files, content);
    request.project.theme = Some(theme.to_string());
    request
}

#[test]
fn renders_a_document_to_pdf() {
    let request = request(
        &[("content/one.typ", "= One\n\nHello.\n")],
        &["content/one.typ"],
    );

    let rendered = render_project(&request).expect("the document should render");

    assert!(
        rendered.pdf.starts_with(b"%PDF"),
        "the output should be a PDF"
    );
    assert_eq!(rendered.outline.page_count, 1);
}

#[test]
fn builds_the_outline_from_the_headings() {
    let request = request(
        &[
            (
                "content/one.typ",
                "= One\n\nText.\n\n== Two\n\nMore text.\n",
            ),
            ("content/two.typ", "= Three\n"),
        ],
        &["content/one.typ", "content/two.typ"],
    );

    let outline = render_project_outline(&request).expect("the outline should build");

    let titles: Vec<&str> = outline
        .entries
        .iter()
        .map(|entry| entry.title.as_str())
        .collect();
    assert_eq!(titles, vec!["One", "Two", "Three"]);

    let levels: Vec<u8> = outline.entries.iter().map(|entry| entry.level).collect();
    assert_eq!(levels, vec![1, 2, 1]);

    // The second heading is a child of the first.
    assert_eq!(outline.entries[0].children, vec![1]);
    assert!(outline.entries[1].children.is_empty());
    assert!(outline.entries[2].children.is_empty());
}

#[test]
fn gives_every_heading_a_unique_anchor() {
    let request = request(
        &[("content/one.typ", "= Setup\n\n= Setup\n\n= Setup!\n")],
        &["content/one.typ"],
    );

    let outline = render_project_outline(&request).expect("the outline should build");

    let anchors: Vec<&str> = outline
        .entries
        .iter()
        .map(|entry| entry.anchor.as_str())
        .collect();
    assert_eq!(anchors, vec!["setup", "setup-2", "setup-3"]);
}

#[test]
fn a_heading_without_letters_still_gets_an_anchor() {
    let request = request(&[("content/one.typ", "= 123\n")], &["content/one.typ"]);

    let outline = render_project_outline(&request).expect("the outline should build");

    assert_eq!(outline.entries[0].anchor, "123");
}

#[test]
fn the_theme_reaches_the_included_content() {
    let request = themed_request(
        &[
            (
                "theme.typ",
                "#let theme(body) = { set text(size: 40pt); body }\n",
            ),
            ("content/one.typ", "= One\n\nHello.\n"),
        ],
        &["content/one.typ"],
        "theme.typ",
    );

    let rendered = render_project(&request).expect("the document should render");

    // A theme that only sets a text size still lays the document out.
    assert!(rendered.outline.page_count >= 1);
    assert_eq!(rendered.outline.entries[0].title, "One");
}

#[test]
fn a_missing_theme_is_an_error() {
    let request = themed_request(
        &[("content/one.typ", "= One\n")],
        &["content/one.typ"],
        "theme.typ",
    );

    let error = render_project(&request).expect_err("the render should fail");

    assert!(
        error.contains("theme.typ"),
        "the error should name the theme, got: {error}"
    );
}

#[test]
fn a_syntax_error_is_reported_with_its_path() {
    let request = request(
        &[("content/one.typ", "= One\n\n#let = broken\n")],
        &["content/one.typ"],
    );

    let error = render_project(&request).expect_err("the render should fail");

    assert!(
        error.contains("content/one.typ"),
        "the error should name the file, got: {error}"
    );
}

#[test]
fn a_missing_content_file_is_a_warning() {
    let request = request(
        &[("content/one.typ", "= One\n")],
        &["content/one.typ", "content/two.typ"],
    );

    let rendered = render_project(&request).expect("the document should render");

    let missing: Vec<&str> = rendered
        .warnings
        .iter()
        .filter(|warning| warning.code == "content.missing")
        .map(|warning| warning.path.as_deref().unwrap_or_default())
        .collect();
    assert_eq!(missing, vec!["content/two.typ"]);
}

#[test]
fn an_unknown_font_family_is_a_warning() {
    let request = request(
        &[(
            "content/one.typ",
            "#set text(font: \"No Such Family\")\n\nHello.\n",
        )],
        &["content/one.typ"],
    );

    let rendered = render_project(&request).expect("the document should render");

    let unresolved = rendered
        .warnings
        .iter()
        .find(|warning| warning.code == "font.unresolved");
    assert!(
        unresolved.is_some(),
        "the warning should be reported, got: {:?}",
        rendered.warnings
    );
}

#[test]
fn a_missing_image_is_a_warning() {
    let request = request(
        &[("content/one.typ", "#image(\"assets/missing.png\")\n")],
        &["content/one.typ"],
    );

    let rendered = render_project(&request).expect("the document should render");

    let missing = rendered
        .warnings
        .iter()
        .find(|warning| warning.code == "asset.missing");
    assert!(
        missing.is_some(),
        "the warning should be reported, got: {:?}",
        rendered.warnings
    );
}

#[test]
fn the_pages_are_rendered_as_images() {
    let request = request(
        &[("content/one.typ", "= One\n\nHello.\n")],
        &["content/one.typ"],
    );

    let pages = render_project_pages(&request).expect("the pages should render");

    assert_eq!(pages.page_count, 1);
    assert_eq!(pages.pages.len(), 1);
    assert_eq!(pages.pages[0].index, 0);

    let png = base64::engine::general_purpose::STANDARD
        .decode(&pages.pages[0].png_base64)
        .expect("the page should be base64");
    assert!(
        png.starts_with(&[0x89, b'P', b'N', b'G']),
        "the page should be a PNG"
    );
}

#[test]
fn a_page_break_makes_a_new_page() {
    let request = request(
        &[(
            "content/one.typ",
            "= One

Text.

#pagebreak()

= Two

More text.
",
        )],
        &["content/one.typ"],
    );

    let rendered = render_project(&request).expect("the document should render");

    assert_eq!(
        rendered.outline.page_count, 2,
        "the page break should start a second page"
    );
}

#[test]
fn a_landscape_page_is_flipped_rather_than_resized() {
    let mut request = request(&[("content/one.typ", "= One\n")], &["content/one.typ"]);
    request.project.page = PageConfig {
        size: "A4".to_string(),
        orientation: "landscape".to_string(),
    };

    let rendered = render_project(&request).expect("the document should render");

    // A flipped A4 page is wider than it is tall.
    assert_eq!(rendered.outline.page_count, 1);
}

#[test]
fn a_bundled_font_is_accepted() {
    let font_bytes = include_bytes!("../../public/fonts/inter-400.woff2");
    let encoded = base64::engine::general_purpose::STANDARD.encode(font_bytes);

    let mut request = request(
        &[("content/one.typ", "#set text(font: \"Inter\")\n\nHello.\n")],
        &["content/one.typ"],
    );
    request.fonts = vec![ProjectFont {
        path: "fonts/inter-400.woff2".to_string(),
        base64: encoded,
        mime_type: "font/woff2".to_string(),
    }];

    let rendered = render_project(&request).expect("the document should render");

    let unresolved = rendered
        .warnings
        .iter()
        .find(|warning| warning.code == "font.unresolved");
    assert!(
        unresolved.is_none(),
        "the bundled family should resolve, got: {:?}",
        rendered.warnings
    );
}

#[test]
fn the_first_font_of_a_family_wins_a_tie() {
    // The renderer lists the project's fonts before the built-in ones, so that
    // a family the project bundles wins over a built-in of the same name.
    // Typst keeps the first font of a family that scores best, which is what
    // makes that order work.
    let font_bytes = include_bytes!("../../public/fonts/inter-400.woff2");
    let mut input = font_bytes.as_slice();
    let ttf = woff2_patched::convert_woff2_to_ttf(&mut input).expect("the font should decode");

    let first = Font::new(Bytes::new(ttf.clone()), 0).expect("the font should parse");
    let second = Font::new(Bytes::new(ttf), 0).expect("the font should parse");

    let mut book = FontBook::new();
    book.push(first.info().clone());
    book.push(second.info().clone());

    let family = first.info().family.to_lowercase();
    assert_eq!(
        book.select(&family, FontVariant::default()),
        Some(0),
        "the first font of a family should win a tie"
    );
}

#[test]
fn the_entries_of_an_outline_are_in_document_order() {
    let request = request(
        &[
            ("content/one.typ", "= First\n"),
            ("content/two.typ", "= Second\n"),
            ("content/three.typ", "= Third\n"),
        ],
        &["content/one.typ", "content/two.typ", "content/three.typ"],
    );

    let outline = render_project_outline(&request).expect("the outline should build");

    let titles: Vec<&str> = outline
        .entries
        .iter()
        .map(|entry: &OutlineEntry| entry.title.as_str())
        .collect();
    assert_eq!(titles, vec!["First", "Second", "Third"]);
}
