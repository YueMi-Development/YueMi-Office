//! Rendering a project with Typst.
//!
//! A project is a folder of Typst source files, a theme file, fonts and
//! assets. Everything the renderer needs arrives in the request, so the
//! renderer never touches the user's disk and the same request always
//! produces the same document (PRD section 8).
//!
//! The renderer works in four steps:
//!
//! 1. The request's files, assets and fonts are put into an in-memory
//!    [`World`] under their project-relative paths.
//! 2. An entry file is synthesised at the project root. It sets the page
//!    geometry, imports the theme and includes the content files. Because
//!    Typst resolves `/`-prefixed paths against the project root, the entry
//!    file works no matter how deeply the content files are nested.
//! 3. The document is compiled. Errors are fatal; warnings are collected and
//!    reported alongside the result.
//! 4. The document is exported as a PDF, as an outline and as page images.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use typst::diag::{FileError, FileResult, Severity};
use typst::foundations::{Bytes, Datetime, Duration, NativeElement, StyleChain};
use typst::introspection::Introspector;
use typst::model::HeadingElem;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::{LazyHash, Scalar};
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::{PdfOptions, PdfStandard, PdfStandards, pdf as pdf_export};
use typst_render::RenderOptions;

/// The name of the synthesised entry file.
///
/// The name is reserved: a project cannot have a file of its own with this
/// name, so the entry file can never be confused with a content file.
pub const ENTRY_FILE: &str = "_yuemi.typ";

/// The version of Typst the renderer compiles with.
///
/// The Typst crates do not export their version, so it is pinned here and
/// kept in step with `Cargo.toml` by hand.
pub const TYPST_VERSION: &str = "0.15.1";

/// How many pages are rendered as images.
///
/// Rendering a page is the expensive part of the preview, and a document
/// longer than this is not something a preview needs to show in full.
pub const MAX_RENDERED_PAGES: usize = 8;

/// The scale of the rendered page images, in pixels per typographic point.
const PIXEL_PER_POINT: f64 = 1.5;

/// The page configuration of a project.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageConfig {
    /// The paper size, e.g. `A4`.
    #[serde(default = "default_page_size")]
    pub size: String,
    /// `portrait` or `landscape`.
    #[serde(default = "default_orientation")]
    pub orientation: String,
}

impl Default for PageConfig {
    fn default() -> Self {
        Self {
            size: default_page_size(),
            orientation: default_orientation(),
        }
    }
}

fn default_page_size() -> String {
    "A4".to_string()
}

fn default_orientation() -> String {
    "portrait".to_string()
}

/// The PDF flavour a project asks for.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfConfig {
    /// The PDF standard to conform to, e.g. `pdf/a-3b`.
    #[serde(default)]
    pub variant: Option<String>,
}

/// The `project.json` of a document project.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// The version of the on-disk project format.
    #[serde(default)]
    pub schema_version: u32,
    /// The document's title.
    #[serde(default)]
    pub title: String,
    /// The document's language, as a BCP 47 tag.
    #[serde(default)]
    pub language: String,
    /// The content files, relative to the project root, in document order.
    #[serde(default)]
    pub content: Vec<String>,
    /// The theme file, relative to the project root.
    ///
    /// The theme is a Typst file that exports a `theme` function. It is the
    /// project's stylesheet: it sets the fonts, the heading styles and the
    /// page furniture.
    #[serde(default)]
    pub theme: Option<String>,
    /// The font files bundled with the project.
    #[serde(default)]
    pub fonts: Option<Vec<String>>,
    /// The directory holding images and other assets.
    #[serde(default)]
    pub assets_dir: String,
    /// The page geometry.
    #[serde(default)]
    pub page: PageConfig,
    /// The PDF flavour.
    #[serde(default)]
    pub pdf: PdfConfig,
}

/// A text file within a project.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    /// The path relative to the project root, with forward slashes.
    pub path: String,
    /// The file's contents.
    pub text: String,
}

/// A binary asset within a project.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAsset {
    /// The path relative to the project root, with forward slashes.
    pub path: String,
    /// The base64-encoded contents.
    pub base64: String,
    /// The MIME type, e.g. `image/png`.
    #[serde(default)]
    pub mime_type: String,
}

/// A font file bundled with a project.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFont {
    /// The path relative to the project root, with forward slashes.
    pub path: String,
    /// The base64-encoded contents.
    pub base64: String,
    /// The MIME type, e.g. `font/woff2`.
    #[serde(default)]
    pub mime_type: String,
}

/// Everything the renderer needs to lay out a document.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    /// The project the files belong to.
    pub project: Project,
    /// The project's text files.
    #[serde(default)]
    pub files: Vec<ProjectFile>,
    /// The project's assets.
    #[serde(default)]
    pub assets: Vec<ProjectAsset>,
    /// The project's fonts.
    #[serde(default)]
    pub fonts: Vec<ProjectFont>,
}

/// A non-fatal problem noticed while rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderWarning {
    /// A stable code, e.g. `font.unresolved`.
    pub code: String,
    /// A message the writer can act on.
    pub message: String,
    /// The project-relative path the warning relates to, when it is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// One entry in the document outline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    /// The heading text as it appears in the document.
    pub title: String,
    /// The heading level, 1 to 6.
    pub level: u8,
    /// The zero-based page the heading lands on.
    pub page: usize,
    /// The anchor id of the heading.
    pub anchor: String,
    /// The indices of this entry's children in the outline's entry list.
    #[serde(default)]
    pub children: Vec<usize>,
}

/// The document's outline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderOutline {
    /// The outline's entries, in document order.
    pub entries: Vec<OutlineEntry>,
    /// How many pages the document has.
    pub page_count: usize,
}

/// One rendered page of a document, as a PNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPage {
    /// The zero-based index of the page.
    pub index: usize,
    /// The base64-encoded PNG.
    pub png_base64: String,
}

/// The rendered pages of a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPages {
    /// How many pages the document has.
    pub page_count: usize,
    /// The rendered pages, at most [`MAX_RENDERED_PAGES`] of them.
    pub pages: Vec<RenderPage>,
    /// The warnings noticed while rendering.
    pub warnings: Vec<RenderWarning>,
}

/// A rendered document.
#[derive(Debug, Clone)]
pub struct RenderedDocument {
    /// The PDF bytes.
    pub pdf: Vec<u8>,
    /// The document's outline.
    pub outline: RenderOutline,
    /// The warnings noticed while rendering.
    pub warnings: Vec<RenderWarning>,
    /// The laid-out document, for callers that need more of it.
    pub document: PagedDocument,
}

/// What a render command gives back.
///
/// The PDF is base64-encoded rather than sent as raw bytes, because a Tauri
/// command's return value is JSON and a byte array of that size would
/// become a list of numbers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    /// The PDF, base64-encoded.
    pub pdf: String,
    /// The document's outline, from the same render.
    pub outline: RenderOutline,
    /// The warnings noticed while rendering.
    pub warnings: Vec<RenderWarning>,
}

/// The in-memory world a project is compiled in.
struct ProjectWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    files: HashMap<FileId, Bytes>,
    main: FileId,
    fonts: Vec<Font>,
    today: Option<Datetime>,
}

impl World for ProjectWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        let bytes = self
            .files
            .get(&id)
            .ok_or_else(|| FileError::NotFound(PathBuf::from(id.vpath().get_without_slash())))?;
        let text =
            String::from_utf8(bytes.as_slice().to_vec()).map_err(|_| FileError::InvalidUtf8)?;
        Ok(Source::new(id, text))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.files
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(PathBuf::from(id.vpath().get_without_slash())))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        self.today
    }
}

/// Turns a project-relative path into a file id.
fn file_id(path: &str) -> Result<FileId, String> {
    let virtual_path =
        VirtualPath::new(path).map_err(|error| format!("Invalid path '{path}': {error}"))?;
    Ok(FileId::new(RootedPath::new(
        VirtualRoot::Project,
        virtual_path,
    )))
}

/// Maps a page size name onto the name Typst knows it by.
///
/// Typst writes the sizes in kebab case and calls the US sizes `us-*`.
fn typst_paper_name(size: &str) -> Option<&'static str> {
    match size.trim().to_ascii_lowercase().as_str() {
        "a0" => Some("a0"),
        "a1" => Some("a1"),
        "a2" => Some("a2"),
        "a3" => Some("a3"),
        "a4" => Some("a4"),
        "a5" => Some("a5"),
        "letter" | "us-letter" => Some("us-letter"),
        "legal" | "us-legal" => Some("us-legal"),
        "tabloid" | "us-tabloid" => Some("us-tabloid"),
        _ => None,
    }
}

/// Builds the entry file that ties the project together.
///
/// The paths are root-absolute, so they resolve the same way no matter which
/// file includes them.
///
/// A content file the project did not send is left out, so that one missing
/// file does not stop the rest of the document from rendering. The caller
/// reports it as a warning.
fn build_entry_file(project: &Project, available: &dyn Fn(&str) -> bool) -> String {
    let mut entry = String::new();

    let paper = typst_paper_name(&project.page.size).unwrap_or("a4");
    let flipped = project
        .page
        .orientation
        .trim()
        .eq_ignore_ascii_case("landscape");
    entry.push_str(&format!(
        "#set page(paper: \"{paper}\", flipped: {flipped})\n"
    ));

    let theme = project
        .theme
        .as_ref()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .filter(|path| available(path.trim_start_matches('/')));

    if let Some(theme) = theme {
        entry.push_str(&format!(
            "#import \"/{}\": theme\n",
            theme.trim_start_matches('/')
        ));
    }

    let mut includes = String::new();
    for path in &project.content {
        let relative = path.trim().trim_start_matches('/');
        if !available(relative) {
            continue;
        }
        includes.push_str(&format!("#include \"/{relative}\"\n"));
    }

    match theme {
        Some(_) => {
            entry.push_str("#theme[\n");
            entry.push_str(&includes);
            entry.push_str("]\n");
        }
        None => entry.push_str(&includes),
    }

    entry
}

/// Decodes a font file into something Typst can read.
///
/// Typst reads TrueType and OpenType fonts. Web fonts are compressed, so a
/// WOFF2 file is expanded first.
fn decode_font(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.starts_with(b"wOF2") {
        let mut input = bytes;
        return woff2_patched::convert_woff2_to_ttf(&mut input)
            .map_err(|error| format!("Cannot read the font: {error}"));
    }

    if bytes.starts_with(b"wOFF") {
        return Err("WOFF fonts are not supported, use WOFF2 or TTF instead".to_string());
    }

    Ok(bytes.to_vec())
}

/// Collects the fonts the document can use.
///
/// The project's own fonts come first, so that a family the project bundles
/// wins over a built-in family of the same name. Typst keeps the first font
/// of a family that scores best, so the order of this list is the order of
/// preference.
fn collect_fonts(fonts: &[ProjectFont]) -> Result<(Vec<Font>, Vec<String>), String> {
    let mut collected: Vec<Font> = Vec::new();
    let mut families: Vec<String> = Vec::new();

    for font in fonts {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&font.base64)
            .map_err(|error| format!("Cannot decode the font '{}': {error}", font.path))?;
        let decoded = decode_font(&bytes)
            .map_err(|error| format!("Cannot read the font '{}': {error}", font.path))?;

        for face in Font::iter(Bytes::new(decoded)) {
            families.push(face.info().family.clone());
            collected.push(face);
        }
    }

    for data in typst_assets::fonts() {
        for face in Font::iter(Bytes::new(data)) {
            collected.push(face);
        }
    }

    Ok((collected, families))
}

/// Builds the world a project is compiled in.
fn build_world(request: &RenderRequest) -> Result<(ProjectWorld, Vec<RenderWarning>), String> {
    let mut warnings: Vec<RenderWarning> = Vec::new();
    let mut files: HashMap<FileId, Bytes> = HashMap::new();

    for file in &request.files {
        let id = file_id(&file.path)?;
        files.insert(id, Bytes::from_string(file.text.clone()));
    }

    // The theme is a text file like any other; it is only included in the
    // entry file when the project names one.
    if let Some(theme) = request
        .project
        .theme
        .as_ref()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
    {
        let relative = theme.trim_start_matches('/');
        if !files.contains_key(&file_id(relative)?) {
            return Err(format!("The theme file '{theme}' was not found."));
        }
    }

    for asset in &request.assets {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&asset.base64)
            .map_err(|error| format!("Cannot decode the asset '{}': {error}", asset.path))?;
        let relative = asset.path.trim().trim_start_matches('/').to_string();
        files.insert(file_id(&relative)?, Bytes::new(bytes.clone()));

        // A bare file name is also accepted, so that an asset can be reached
        // without spelling out the folder it sits in.
        if let Some(file_name) = relative.rsplit('/').next()
            && !file_name.is_empty()
        {
            files.insert(file_id(file_name)?, Bytes::new(bytes));
        }
    }

    let available: HashSet<String> = request
        .assets
        .iter()
        .map(|asset| asset.path.trim().trim_start_matches('/').to_string())
        .collect();

    // A missing image is a warning rather than a failure: the rest of the
    // document should still render, so the call is taken out before the
    // document is compiled.
    for file in &request.files {
        if !file.path.trim().ends_with(".typ") {
            continue;
        }
        let relative = file.path.trim().trim_start_matches('/');
        let (text, missing) = neutralize_missing_images(relative, &file.text, &available);
        if missing.is_empty() {
            continue;
        }
        for target in missing {
            warnings.push(RenderWarning {
                code: "asset.missing".to_string(),
                message: format!("The file '{target}' was not found in the project."),
                path: Some(file.path.clone()),
            });
        }
        files.insert(file_id(relative)?, Bytes::from_string(text));
    }

    for path in &request.project.content {
        let relative = path.trim().trim_start_matches('/');
        if !request
            .files
            .iter()
            .any(|file| file.path.trim() == relative)
        {
            warnings.push(RenderWarning {
                code: "content.missing".to_string(),
                message: format!(
                    "The content file '{path}' is listed in the project but was not found."
                ),
                path: Some(path.clone()),
            });
        }
    }

    let (fonts, _) = collect_fonts(&request.fonts)?;
    let book = LazyHash::new(FontBook::from_fonts(fonts.iter()));

    let present: HashSet<String> = request
        .files
        .iter()
        .map(|file| file.path.trim().trim_start_matches('/').to_string())
        .collect();

    let entry = build_entry_file(&request.project, &|path| present.contains(path));
    let main = file_id(ENTRY_FILE)?;
    files.insert(main, Bytes::from_string(entry));

    let world = ProjectWorld {
        library: LazyHash::new(Library::builder().build()),
        book,
        files,
        main,
        fonts,
        today: today(),
    };

    Ok((world, warnings))
}

/// The current date, in UTC.
fn today() -> Option<Datetime> {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    let days = (seconds / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    Datetime::from_ymd(year, month, day)
}

/// Turns a count of days since the epoch into a calendar date.
///
/// This is the standard civil-from-days conversion: the epoch is 1970-01-01
/// and the calendar repeats every 400 years with 146097 days.
fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month, day)
}

/// Finds the image calls in a Typst source.
///
/// Each call is returned with the path it refers to and the byte range the
/// call occupies, so that a call can be replaced without moving the text
/// around it.
struct ImageCall {
    /// Where the call starts, at the `image` identifier.
    start: usize,
    /// Where the call ends, after the closing parenthesis.
    end: usize,
    /// The path the call refers to, when it is a plain string literal.
    target: Option<String>,
}

/// Finds the image calls in a Typst source.
fn image_calls(text: &str) -> Vec<ImageCall> {
    let bytes = text.as_bytes();
    let mut calls = Vec::new();
    let mut index = 0;

    while let Some(found_at) = text[index..].find("image") {
        let start = index + found_at;

        // The name has to stand on its own, so that `myimage(` is not taken
        // for an image call.
        let preceded_by_name = start
            .checked_sub(1)
            .and_then(|position| bytes.get(position))
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
        if preceded_by_name {
            index = start + "image".len();
            continue;
        }

        let after = &text[start + "image".len()..];
        let trimmed = after.trim_start();
        let offset = after.len() - trimmed.len();

        if !trimmed.starts_with('(') {
            index = start + "image".len();
            continue;
        }

        let open = start + "image".len() + offset;
        let Some(close) = matching_paren(text, open) else {
            index = start + "image".len();
            continue;
        };

        calls.push(ImageCall {
            start,
            end: close + 1,
            target: first_string_argument(&text[open + 1..close]),
        });

        index = close + 1;
    }

    calls
}

/// Finds the parenthesis that closes the one at `open`.
///
/// String literals are skipped, so a parenthesis inside a path does not
/// count.
fn matching_paren(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut index = open;

    while index < bytes.len() {
        match bytes[index] {
            b'"' | b'\'' => {
                let quote = bytes[index];
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == b'\\' {
                        index += 2;
                        continue;
                    }
                    if bytes[index] == quote {
                        break;
                    }
                    index += 1;
                }
            }
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
        index += 1;
    }

    None
}

/// Reads the first argument of a call, when it is a plain string literal.
fn first_string_argument(arguments: &str) -> Option<String> {
    let trimmed = arguments.trim_start();
    let quote = trimmed.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let body = &trimmed[quote.len_utf8()..];
    let end = body.find(quote)?;
    Some(body[..end].to_string())
}

/// Resolves a path a source refers to, the way Typst does.
///
/// A path that starts with `/` is relative to the project root. Any other
/// path is relative to the folder the source sits in.
fn resolve_reference(source_path: &str, target: &str) -> String {
    let target = target.trim();

    if let Some(rooted) = target.strip_prefix('/') {
        return normalize_path(rooted);
    }

    let directory = match source_path.rfind('/') {
        Some(index) => &source_path[..index],
        None => "",
    };

    if directory.is_empty() {
        normalize_path(target)
    } else {
        normalize_path(&format!("{directory}/{target}"))
    }
}

/// Normalizes a path, resolving `.` and `..`.
///
/// A path that climbs above the project root keeps the `..`, so that it
/// cannot match a file inside the project by accident.
fn normalize_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();

    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => match parts.last() {
                Some(last) if *last != ".." => {
                    parts.pop();
                }
                _ => parts.push(".."),
            },
            other => parts.push(other),
        }
    }

    parts.join("/")
}

/// Replaces the image calls that point at files the project does not have.
///
/// A missing image is a warning rather than a failure: the rest of the
/// document should still render. The call is replaced by spaces of the same
/// length, so nothing else in the file moves and a message about it still
/// points at the right line.
fn neutralize_missing_images(
    source_path: &str,
    text: &str,
    available: &HashSet<String>,
) -> (String, Vec<String>) {
    let mut missing: Vec<String> = Vec::new();
    let mut result = text.to_string();

    for call in image_calls(text) {
        let Some(target) = call.target.as_deref() else {
            continue;
        };

        let cleaned = target.trim();
        if cleaned.is_empty()
            || cleaned.starts_with("data:")
            || cleaned.starts_with("http://")
            || cleaned.starts_with("https://")
        {
            continue;
        }

        let resolved = resolve_reference(source_path, cleaned);
        if available.contains(&resolved) {
            continue;
        }

        missing.push(cleaned.to_string());

        // The call is replaced by an expression of the same length, so that
        // nothing else in the file moves and a message about it still points
        // at the right line.
        let replacement = format!("none{}", " ".repeat(call.end - call.start - 4));
        result.replace_range(call.start..call.end, &replacement);
    }

    (result, missing)
}

/// Compiles a project into a laid-out document.
fn compile_project(request: &RenderRequest) -> Result<(PagedDocument, Vec<RenderWarning>), String> {
    let (world, mut warnings) = build_world(request)?;

    let warned = typst::compile::<PagedDocument>(&world);

    for diagnostic in &warned.warnings {
        if diagnostic.severity != Severity::Warning {
            continue;
        }
        let path = diagnostic
            .span
            .id()
            .map(|id| id.vpath().get_without_slash().to_string())
            .filter(|path| path != ENTRY_FILE);

        let message = diagnostic.message.as_str();
        let code = if message.starts_with("unknown font family:") {
            "font.unresolved"
        } else {
            "typst.warning"
        };

        warnings.push(RenderWarning {
            code: code.to_string(),
            message: message.to_string(),
            path,
        });
    }

    let document = warned.output.map_err(|diagnostics| {
        let mut message = String::new();
        for diagnostic in diagnostics.iter() {
            if !message.is_empty() {
                message.push('\n');
            }
            let path = diagnostic
                .span
                .id()
                .map(|id| id.vpath().get_without_slash().to_string());
            match path {
                Some(path) if path != ENTRY_FILE => {
                    message.push_str(&format!("{path}: {}", diagnostic.message));
                }
                _ => message.push_str(diagnostic.message.as_str()),
            }
        }
        message
    })?;

    Ok((document, warnings))
}

/// Maps a PDF variant onto the standard Typst enforces.
fn pdf_standard(variant: Option<&str>) -> Option<PdfStandard> {
    match variant? {
        "pdf/a-1b" => Some(PdfStandard::A_1b),
        "pdf/a-2b" => Some(PdfStandard::A_2b),
        "pdf/a-2u" => Some(PdfStandard::A_2u),
        "pdf/a-3b" => Some(PdfStandard::A_3b),
        "pdf/a-3u" => Some(PdfStandard::A_3u),
        "pdf/ua-1" => Some(PdfStandard::Ua_1),
        _ => None,
    }
}

/// Builds the PDF export options a project asks for.
fn pdf_options(project: &Project) -> Result<PdfOptions, String> {
    let mut options = PdfOptions::default();

    if let Some(standard) = pdf_standard(project.pdf.variant.as_deref()) {
        let standards = PdfStandards::new(&[standard]).map_err(|error| {
            format!(
                "The PDF variant '{}' cannot be used: {}",
                project.pdf.variant.clone().unwrap_or_default(),
                error.message()
            )
        })?;
        options.standards = standards;
    }

    Ok(options)
}

/// Builds the document's outline from its headings.
///
/// The page numbers come from the laid-out document, so they match the PDF
/// exactly rather than being a second guess.
fn build_outline(document: &PagedDocument) -> RenderOutline {
    let mut entries: Vec<OutlineEntry> = Vec::new();
    let mut taken: HashSet<String> = HashSet::new();

    let headings = document.introspector().query(&HeadingElem::ELEM.select());

    for heading in headings.iter() {
        let Some(heading) = heading.to_packed::<HeadingElem>() else {
            continue;
        };

        let level = heading
            .resolve_level(StyleChain::default())
            .get()
            .clamp(1, 6);
        let text = heading.body.plain_text();

        let title = match &heading.numbers {
            Some(numbers) => format!("{numbers} {text}"),
            None => text.to_string(),
        };

        let page = heading
            .location()
            .and_then(|location| document.introspector().page(location))
            .map(|page| page.get() - 1)
            .unwrap_or(0);

        entries.push(OutlineEntry {
            anchor: slugify(&title, &mut taken),
            title,
            level: level as u8,
            page,
            children: Vec::new(),
        });
    }

    link_children(&mut entries);

    RenderOutline {
        page_count: document.pages().len(),
        entries,
    }
}

/// Turns heading text into an anchor that is unique within the document.
///
/// Anchors are used as link targets, so they are restricted to characters
/// that are safe in a URL fragment.
fn slugify(text: &str, taken: &mut HashSet<String>) -> String {
    let mut slug = String::new();
    let mut pending_separator = false;

    for character in text.trim().chars() {
        if character.is_ascii_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('-');
            }
            pending_separator = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            pending_separator = true;
        }
    }

    let base = if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    };

    let mut candidate = base.clone();
    let mut counter = 2;
    while taken.contains(&candidate) {
        candidate = format!("{base}-{counter}");
        counter += 1;
    }

    taken.insert(candidate.clone());
    candidate
}

/// Fills in each entry's children from the heading levels.
fn link_children(entries: &mut [OutlineEntry]) {
    let mut stack: Vec<usize> = Vec::new();

    for index in 0..entries.len() {
        let level = entries[index].level;
        while let Some(parent) = stack.last()
            && entries[*parent].level >= level
        {
            stack.pop();
        }
        if let Some(parent) = stack.last() {
            entries[*parent].children.push(index);
        }
        stack.push(index);
    }
}

/// Renders a project: the PDF, the outline and the warnings.
pub fn render_project(request: &RenderRequest) -> Result<RenderedDocument, String> {
    let (document, warnings) = compile_project(request)?;

    let options = pdf_options(&request.project)?;
    let pdf = pdf_export(&document, &options).map_err(|diagnostics| {
        format!(
            "Cannot write the PDF: {}",
            diagnostics
                .first()
                .map(|d| d.message.as_str())
                .unwrap_or("unknown error")
        )
    })?;

    let outline = build_outline(&document);

    Ok(RenderedDocument {
        pdf,
        outline,
        warnings,
        document,
    })
}

/// Renders the pages of a project as images.
pub fn render_project_pages(request: &RenderRequest) -> Result<RenderPages, String> {
    let (document, warnings) = compile_project(request)?;

    let options = RenderOptions {
        pixel_per_pt: Scalar::new(PIXEL_PER_POINT),
        render_bleed: false,
    };

    let mut pages = Vec::new();
    for (index, page) in document.pages().iter().enumerate() {
        if index >= MAX_RENDERED_PAGES {
            break;
        }
        let pixmap = typst_render::render(page, &options);
        let png = pixmap
            .encode_png()
            .map_err(|error| format!("Cannot render the page: {error}"))?;
        pages.push(RenderPage {
            index,
            png_base64: base64::engine::general_purpose::STANDARD.encode(png),
        });
    }

    Ok(RenderPages {
        page_count: document.pages().len(),
        pages,
        warnings,
    })
}

/// Renders a project's outline.
pub fn render_project_outline(request: &RenderRequest) -> Result<RenderOutline, String> {
    let (document, _) = compile_project(request)?;
    Ok(build_outline(&document))
}

// The command wrappers the webview calls. The logic lives in the plain
// functions above so it can be tested without a Tauri runtime.
//
// Rendering is CPU-bound and can take a moment, so the commands are async
// and put the work on a blocking thread. Otherwise a long document would
// freeze the window while it compiled.

/// Renders a project and returns the PDF, its outline and the warnings.
#[tauri::command(rename = "render_project")]
pub async fn command_render_project(request: RenderRequest) -> Result<RenderResult, String> {
    let rendered = tokio::task::spawn_blocking(move || render_project(&request))
        .await
        .map_err(|error| format!("The document did not render: {error}"))??;

    Ok(RenderResult {
        pdf: base64::engine::general_purpose::STANDARD.encode(&rendered.pdf),
        outline: rendered.outline,
        warnings: rendered.warnings,
    })
}

/// Renders the pages of a project as images.
#[tauri::command(rename = "render_project_pages")]
pub async fn command_render_project_pages(request: RenderRequest) -> Result<RenderPages, String> {
    tokio::task::spawn_blocking(move || render_project_pages(&request))
        .await
        .map_err(|error| format!("The pages did not render: {error}"))?
}

/// Renders a project's outline.
#[tauri::command(rename = "render_project_outline")]
pub async fn command_render_project_outline(
    request: RenderRequest,
) -> Result<RenderOutline, String> {
    tokio::task::spawn_blocking(move || render_project_outline(&request))
        .await
        .map_err(|error| format!("The outline did not render: {error}"))?
}

/// Says whether the renderer is working, and with what.
#[tauri::command(rename = "render_health")]
pub fn command_render_health() -> HealthResponse {
    HealthResponse {
        status: "ok".to_string(),
        typst_version: TYPST_VERSION.to_string(),
        rust_version: env!("CARGO_PKG_RUST_VERSION").to_string(),
    }
}

/// What the renderer says about itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    /// Always `ok`: the command only answers when it can.
    pub status: String,
    /// The version of Typst the renderer compiles with.
    pub typst_version: String,
    /// The version of Rust the renderer is built with.
    pub rust_version: String,
}
