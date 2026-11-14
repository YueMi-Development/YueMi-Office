//! The tools the AI assistant can use on a document.
//!
//! The assistant never edits a file directly. It reads the document with the
//! read-only tools and asks for changes with `propose_edit` and
//! `propose_style`, and the user decides whether those changes are applied
//! (PRD section 7).
//!
//! Every tool works on the project that travelled with the request. The
//! renderer is stateless, so a tool cannot reach the user's disk and cannot
//! reach anything outside the project folder.

use std::ops::Range;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use typst::syntax::{LinkedNode, Source, SyntaxKind};

use crate::diff::{DiffHunk, diff_hunks};
use crate::providers::ToolDefinition;
use crate::render::{Project, ProjectAsset, ProjectFile, ProjectFont, RenderRequest};

/// One heading and the text that follows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// The file the section is in.
    pub path: String,
    /// The heading's text.
    pub title: String,
    /// The heading level, 1 to 6.
    pub level: usize,
    /// The line the heading is on, counting from 1.
    pub line: usize,
    /// The last line of the section, counting from 1.
    pub end_line: usize,
}

/// How many lines the text has, counted the way the whole app counts them.
///
/// A text that ends with a newline has an empty last line, which is what
/// every other side of the app counts, so the count matches.
fn line_count(text: &str) -> usize {
    text.split('\n').count()
}

/// Splits text into the lines a section is measured in.
fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n').collect()
}

/// Collects the text of the leaves under a node.
fn leaf_text(node: &LinkedNode) -> String {
    let mut text = String::new();
    for child in node.children() {
        match child.get().kind() {
            SyntaxKind::Text => text.push_str(child.get().leaf_text()),
            _ => text.push_str(&leaf_text(&child)),
        }
    }
    text
}

/// Collects the headings of a Typst file.
///
/// A heading is a line that starts with one or more `=` marks, so the depth
/// of the heading is how many marks it has. A `=` that is not at the start of
/// a line is ordinary text and is not a heading.
fn collect_headings(node: &LinkedNode, headings: &mut Vec<(usize, usize, String)>) {
    for child in node.children() {
        match child.get().kind() {
            SyntaxKind::Code | SyntaxKind::CodeBlock => continue,
            SyntaxKind::Heading => {
                let level = child
                    .children()
                    .find(|grandchild| grandchild.get().kind() == SyntaxKind::HeadingMarker)
                    .map(|marker| marker.get().leaf_text().chars().count())
                    .unwrap_or(1);
                let title = leaf_text(&child);
                headings.push((child.offset(), level, title));
            }
            _ => collect_headings(&child, headings),
        }
    }
}

/// Finds the sections of a Typst file.
///
/// A section runs from its heading to the heading of the same or a higher
/// level that comes after it, because that heading starts a new section.
pub fn find_sections(path: &str, text: &str) -> Vec<Section> {
    let source = Source::detached(text);
    let root = source.root();
    let mut headings = Vec::new();
    collect_headings(&LinkedNode::new(root), &mut headings);

    let total = line_count(text);
    let mut sections: Vec<Section> = Vec::new();

    for (position, (offset, level, title)) in headings.iter().enumerate() {
        let line = source
            .lines()
            .byte_to_line(*offset)
            .map(|index| index + 1)
            .unwrap_or(1);

        let end_line = headings
            .iter()
            .skip(position + 1)
            .find(|(_, next_level, _)| *next_level <= *level)
            .and_then(|(next_offset, _, _)| source.lines().byte_to_line(*next_offset))
            .unwrap_or(total);

        sections.push(Section {
            path: path.to_string(),
            title: title.clone(),
            level: *level,
            line,
            end_line,
        });
    }

    sections
}

/// A change the assistant proposes to make to one file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedEdit {
    /// The change's identifier, unique within a session.
    pub id: String,
    /// The project-relative path of the file being changed.
    pub path: String,
    /// `create` when the file is not there yet, `replace` otherwise.
    pub kind: String,
    /// The file's contents before the change.
    pub old_text: String,
    /// The file's contents after the change.
    pub new_text: String,
    /// The differences between the two.
    #[serde(default)]
    pub hunks: Vec<DiffHunk>,
}

/// The project a tool works on.
pub struct ToolContext {
    /// The project the files belong to.
    pub project: Project,
    /// The project's text files.
    pub files: Vec<ProjectFile>,
    /// The project's assets.
    pub assets: Vec<ProjectAsset>,
    /// The project's fonts.
    pub fonts: Vec<ProjectFont>,
    /// The changes the tools have proposed so far.
    pub edits: Vec<ProposedEdit>,
}

impl ToolContext {
    /// Builds a context over a project.
    pub fn new(
        project: Project,
        files: Vec<ProjectFile>,
        assets: Vec<ProjectAsset>,
        fonts: Vec<ProjectFont>,
    ) -> Self {
        Self {
            project,
            files,
            assets,
            fonts,
            edits: Vec::new(),
        }
    }

    /// The text of a file, or an empty string when it is not there.
    pub fn file_text(&self, path: &str) -> String {
        self.files
            .iter()
            .find(|file| file.path == path)
            .map(|file| file.text.clone())
            .unwrap_or_default()
    }

    /// Whether the project holds a file at the path.
    fn has_file(&self, path: &str) -> bool {
        self.files.iter().any(|file| file.path == path)
    }

    /// The project's content files, in document order.
    fn content_files(&self) -> Vec<&ProjectFile> {
        self.project
            .content
            .iter()
            .filter_map(|path| self.files.iter().find(|file| &file.path == path))
            .collect()
    }

    /// Records a change the assistant proposes to make.
    fn propose(&mut self, path: &str, old_text: &str, new_text: &str, kind: &str) -> ProposedEdit {
        let hunks = diff_hunks(old_text, new_text, crate::diff::DEFAULT_CONTEXT);
        let edit = ProposedEdit {
            id: format!("edit-{}", self.edits.len() + 1),
            path: path.to_string(),
            kind: kind.to_string(),
            old_text: old_text.to_string(),
            new_text: new_text.to_string(),
            hunks,
        };
        self.edits.push(edit.clone());
        edit
    }

    /// The request the renderer works on.
    fn render_request(&self) -> RenderRequest {
        RenderRequest {
            project: self.project.clone(),
            files: self.files.clone(),
            assets: self.assets.clone(),
            fonts: self.fonts.clone(),
        }
    }

    /// The render request with the changes proposed so far put in place.
    ///
    /// The changes are put in place because the document is compiled as it
    /// would be if the user kept them, not as it was when the session
    /// started.
    ///
    /// The file at `path` is replaced with `new_text` when it is given. A
    /// file that is not in the project yet is only added to the project when
    /// it has text, because a file that is not there is not part of the
    /// document.
    fn request_with_changes(&self, path: &str, new_text: Option<&str>) -> RenderRequest {
        let mut files = self.files.clone();

        for edit in &self.edits {
            match files.iter_mut().find(|file| file.path == edit.path) {
                Some(file) => file.text = edit.new_text.clone(),
                None => files.push(ProjectFile {
                    path: edit.path.clone(),
                    text: edit.new_text.clone(),
                }),
            }
        }

        let mut project = self.project.clone();

        if let Some(new_text) = new_text {
            match files.iter_mut().find(|file| file.path == path) {
                Some(file) => file.text = new_text.to_string(),
                None => files.push(ProjectFile {
                    path: path.to_string(),
                    text: new_text.to_string(),
                }),
            }

            let is_typst = path.to_ascii_lowercase().ends_with(".typ");
            let is_theme = project
                .theme
                .as_deref()
                .map(|theme| theme == path)
                .unwrap_or(false);

            if is_typst && !is_theme && !project.content.iter().any(|content| content == path) {
                project.content.push(path.to_string());
            }
        }

        RenderRequest {
            project,
            files,
            assets: self.assets.clone(),
            fonts: self.fonts.clone(),
        }
    }
}

/// A tool that could not do what it was asked.
type ToolError = String;

/// The arguments of a call, with the empty ones filled in.
fn arguments_of(arguments: Option<&Value>) -> Value {
    arguments
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}))
}

/// A string argument, when it is one and it is not empty.
fn string_argument(arguments: &Value, name: &str) -> Option<String> {
    arguments
        .get(name)
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

/// An integer argument, when it is one.
fn integer_argument(arguments: &Value, name: &str) -> Option<i64> {
    arguments.get(name).and_then(|value| {
        if value.is_boolean() {
            return None;
        }
        if let Some(number) = value.as_i64() {
            return Some(number);
        }
        value
            .as_str()
            .map(|text| text.trim())
            .filter(|text| {
                !text.is_empty()
                    && text
                        .strip_prefix('-')
                        .unwrap_or(text)
                        .chars()
                        .all(|character| character.is_ascii_digit())
            })
            .and_then(|text| text.parse().ok())
    })
}

/// Lists the sections of the document, in document order.
fn tool_list_sections(context: &ToolContext, arguments: &Value) -> Result<Value, ToolError> {
    let path = string_argument(arguments, "path");

    let files: Vec<&ProjectFile> = match &path {
        Some(path) => context
            .content_files()
            .into_iter()
            .filter(|file| &file.path == path)
            .collect(),
        None => context.content_files(),
    };

    let mut sections = Vec::new();
    for file in files {
        for section in find_sections(&file.path, &file.text) {
            sections.push(json!({
                "path": section.path,
                "title": section.title,
                "level": section.level,
                "line": section.line,
                "endLine": section.end_line,
            }));
        }
    }

    Ok(json!({ "sections": sections }))
}

/// Reads a section of the document, or a range of lines of a file.
fn tool_read_section(context: &ToolContext, arguments: &Value) -> Result<Value, ToolError> {
    let path = string_argument(arguments, "path")
        .ok_or_else(|| "A 'path' is needed to read a section.".to_string())?;

    let file = context
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or_else(|| format!("There is no file at '{path}' in this project."))?;

    let lines = split_lines(&file.text);

    if let Some(heading) = string_argument(arguments, "heading") {
        let wanted = heading.trim_start_matches('#').trim().to_lowercase();
        for section in find_sections(&path, &file.text) {
            if section.title.trim().to_lowercase() == wanted {
                let body = lines
                    .get(section.line - 1..section.end_line)
                    .unwrap_or_default()
                    .join("\n");
                return Ok(json!({
                    "path": path,
                    "title": section.title,
                    "startLine": section.line,
                    "endLine": section.end_line,
                    "text": body,
                }));
            }
        }
        return Err(format!(
            "There is no section called '{heading}' in '{path}'."
        ));
    }

    let start = integer_argument(arguments, "startLine")
        .ok_or_else(|| "A 'heading' or a 'startLine' is needed to read a section.".to_string())?;

    let start = start.max(1);
    let end = match integer_argument(arguments, "endLine") {
        Some(end) if end >= start => (end as usize).min(lines.len()),
        _ => lines.len(),
    };

    Ok(json!({
        "path": path,
        "startLine": start,
        "endLine": end,
        "text": lines.get((start - 1) as usize..end).unwrap_or_default().join("\n"),
    }))
}

/// Searches the project's text files for a string.
fn tool_search(context: &ToolContext, arguments: &Value) -> Result<Value, ToolError> {
    let query = string_argument(arguments, "query")
        .ok_or_else(|| "A 'query' is needed to search.".to_string())?;

    let path = string_argument(arguments, "path");
    let case_sensitive = arguments
        .get("caseSensitive")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let needle = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };

    let mut matches = Vec::new();
    for file in &context.files {
        if let Some(path) = &path
            && &file.path != path
        {
            continue;
        }
        for (index, line) in split_lines(&file.text).iter().enumerate() {
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if haystack.contains(&needle) {
                matches.push(json!({
                    "path": file.path,
                    "line": index + 1,
                    "text": line.trim(),
                }));
            }
        }
    }

    Ok(json!({
        "query": query,
        "matches": matches,
        "count": matches.len(),
    }))
}

/// The syntax errors in a Typst file, if it has any.
///
/// A file that does not parse is a file the renderer cannot use, so a change
/// that leaves it broken is refused before the user is asked about it. A
/// file that is not Typst is left alone, because it is not parsed as Typst.
fn typst_errors(path: &str, text: &str) -> Vec<String> {
    if !path.to_ascii_lowercase().ends_with(".typ") {
        return Vec::new();
    }

    let root = typst::syntax::parse(text);
    let (errors, _warnings) = root.errors_and_warnings();

    errors
        .into_iter()
        .map(|error| error.message.to_string())
        .collect()
}

/// Whether a change would leave the file unparseable.
///
/// A file that does not parse is a file the renderer cannot use, so a change
/// that leaves it broken is refused before the user is asked about it.
///
/// The usual cause is a reply that stopped part way through, which leaves the
/// file cut off in the middle of a block. A file that was already broken is
/// refused as well: the assistant is told to write the whole file again, so
/// it can put the file right rather than make it worse.
fn breaks_the_file(path: &str, new_text: &str) -> Option<String> {
    let errors = typst_errors(path, new_text);

    if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    }
}

/// Whether a change would leave the document unable to compile.
///
/// A file can parse and still not compile, e.g. when a `show` rule names a
/// variable that is not there. The document is compiled with and without the
/// change, and the change is only held against it when the document compiled
/// before and does not compile after.
///
/// A document that was already broken is not held against the change: the
/// assistant may be the one repairing it.
fn breaks_the_compile(context: &ToolContext, path: &str, new_text: &str) -> Option<String> {
    if !path.to_ascii_lowercase().ends_with(".typ") {
        return None;
    }

    // The document as it is now, with the changes proposed so far put in
    // place. When it does not compile, it was already broken.
    if crate::render::check_project(&context.request_with_changes(path, None)).is_err() {
        return None;
    }

    // The document compiled a moment ago, so every error in it is one the
    // change brought about.
    let errors =
        crate::render::check_project(&context.request_with_changes(path, Some(new_text))).err()?;

    Some(errors.replace('\n', "; "))
}

/// The reason a change is refused, if it is.
///
/// A change that breaks the document is refused before the user is asked
/// about it, so the user is never offered a document that does not work.
fn refusal_reason(context: &ToolContext, path: &str, new_text: &str) -> Option<String> {
    breaks_the_file(path, new_text).or_else(|| breaks_the_compile(context, path, new_text))
}

/// The message a refused change is reported with.
///
/// The assistant reads this, so it says what went wrong and what to do
/// about it, rather than only that something did.
fn refused_change(path: &str, reason: &str) -> String {
    format!(
        "The new contents of '{path}' are not valid Typst: {reason}. \
         The file was left as it was. Write the whole file again, \
         including the parts you did not change."
    )
}

/// Proposes a new version of a file.
fn tool_propose_edit(context: &mut ToolContext, arguments: &Value) -> Result<Value, ToolError> {
    let path = string_argument(arguments, "path")
        .ok_or_else(|| "A 'path' is needed to propose an edit.".to_string())?;

    let new_text = arguments
        .get("newText")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "The 'newText' of a proposed edit has to be text.".to_string())?
        .to_string();

    let old_text = context.file_text(&path);
    let kind = if context.has_file(&path) {
        "replace"
    } else {
        "create"
    };

    if let Some(reason) = refusal_reason(context, &path, &new_text) {
        return Err(refused_change(&path, &reason));
    }

    let edit = context.propose(&path, &old_text, &new_text, kind);

    Ok(json!({
        "path": path,
        "kind": kind,
        "hunks": edit.hunks.len(),
    }))
}

/// Where a style lives in a theme file.
#[derive(Debug, Clone, PartialEq, Eq)]
enum StyleTarget {
    /// A `set` rule, whose arguments are replaced.
    Set(Range<usize>),
    /// A `show` rule, whose recipe is replaced.
    Show(Range<usize>),
    /// A `let` binding, whose value is replaced.
    Let(Range<usize>),
}

/// The kind of style a selector names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StyleKind {
    /// A style set on an element, e.g. `text`.
    Set,
    /// A style shown by a rule, e.g. `heading`.
    Show,
    /// A style held in a binding, e.g. `accent`.
    Let,
}

impl StyleKind {
    /// The word that names the kind in a selector.
    fn word(self) -> &'static str {
        match self {
            StyleKind::Set => "set",
            StyleKind::Show => "show",
            StyleKind::Let => "let",
        }
    }
}

/// Reads a selector into the kind of style it names and the name of it.
///
/// A bare name is looked for in every kind of style, so that `heading` finds
/// both a `show` rule and a `set` rule. The words `set`, `show` and `let`
/// say what is meant, so a name that is also an element can be made
/// unambiguous.
fn parse_selector(selector: &str) -> (Option<StyleKind>, String) {
    let trimmed = selector.trim();
    for kind in [StyleKind::Set, StyleKind::Show, StyleKind::Let] {
        let prefix = format!("{} ", kind.word());
        if let Some(rest) = trimmed.strip_prefix(prefix.as_str()) {
            return (Some(kind), rest.trim().to_string());
        }
    }
    (None, trimmed.to_string())
}

/// The name a binding holds.
fn binding_name(node: &LinkedNode) -> Option<String> {
    for child in node.children() {
        match child.get().kind() {
            SyntaxKind::Closure => {
                return child
                    .children()
                    .find(|grandchild| grandchild.get().kind() == SyntaxKind::Ident)
                    .map(|ident| ident.get().leaf_text().to_string());
            }
            SyntaxKind::Ident => return Some(child.get().leaf_text().to_string()),
            _ => {}
        }
    }
    None
}

/// The value a binding holds, and where it is in the file.
fn value_range(node: &LinkedNode) -> Option<Range<usize>> {
    // A binding of a function holds its body in a closure, so the value is
    // what the closure holds rather than the closure itself.
    for child in node.children() {
        if child.get().kind() == SyntaxKind::Closure {
            let last = child.children().next_back()?;
            return Some(last.offset()..last.offset() + last.get().len());
        }
    }

    let last = node.children().next_back()?;
    Some(last.offset()..last.offset() + last.get().len())
}

/// Looks for a style of the given kind and name in a theme file.
fn find_style(text: &str, kind: StyleKind, name: &str) -> Option<StyleTarget> {
    let source = Source::detached(text);
    let linked = LinkedNode::new(source.root());
    find_style_in(&linked, kind, name)
}

/// Looks for a style in a node and the nodes under it.
fn find_style_in(node: &LinkedNode, kind: StyleKind, name: &str) -> Option<StyleTarget> {
    for child in node.children() {
        match child.get().kind() {
            SyntaxKind::SetRule if kind == StyleKind::Set => {
                if let Some(found) = set_rule_range(&child, name) {
                    return Some(StyleTarget::Set(found));
                }
            }
            SyntaxKind::ShowRule if kind == StyleKind::Show => {
                if let Some(found) = show_rule_range(&child, name) {
                    return Some(StyleTarget::Show(found));
                }
            }
            SyntaxKind::LetBinding if kind == StyleKind::Let => {
                if binding_name(&child).as_deref() == Some(name)
                    && let Some(range) = value_range(&child)
                {
                    return Some(StyleTarget::Let(range));
                }
            }
            _ => {}
        }

        if let Some(found) = find_style_in(&child, kind, name) {
            return Some(found);
        }
    }

    None
}

/// The arguments of a `set` rule, when it sets the named element.
fn set_rule_range(node: &LinkedNode, name: &str) -> Option<Range<usize>> {
    let children: Vec<LinkedNode> = node.children().collect();

    let target = children
        .iter()
        .find(|child| child.get().kind() == SyntaxKind::Ident)
        .map(|child| child.get().leaf_text().to_string())?;

    if target != name {
        return None;
    }

    // The arguments come after the element they belong to.
    let position = children
        .iter()
        .position(|child| child.get().kind() == SyntaxKind::Ident)?;
    let args = children[position + 1..]
        .iter()
        .find(|child| child.get().kind() == SyntaxKind::Args)?;

    Some(args.offset()..args.offset() + args.get().len())
}

/// The recipe of a `show` rule, when it shows the named element.
fn show_rule_range(node: &LinkedNode, name: &str) -> Option<Range<usize>> {
    let children: Vec<LinkedNode> = node.children().collect();

    let colon = children
        .iter()
        .position(|child| child.get().kind() == SyntaxKind::Colon)?;

    let selector = children[..colon]
        .iter()
        .find(|child| child.get().kind() == SyntaxKind::Ident)
        .map(|child| child.get().leaf_text().to_string())?;

    if selector != name {
        return None;
    }

    let recipe = children[colon + 1..].last()?;
    Some(recipe.offset()..recipe.offset() + recipe.get().len())
}

/// Turns a JSON value into the Typst code that stands for it.
fn typst_value(value: &Value) -> String {
    match value {
        Value::Null => "none".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => typst_string(text),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(typst_value).collect();
            format!("({})", parts.join(", "))
        }
        Value::Object(entries) => {
            let parts: Vec<String> = entries
                .iter()
                .map(|(name, value)| format!("{name}: {}", typst_value(value)))
                .collect();
            format!("({})", parts.join(", "))
        }
    }
}

/// Whether a string is Typst code rather than a piece of text.
///
/// The values of a style's declarations are Typst code, so a size, a
/// colour or a call is written as it is. Anything else is a word the
/// document shows, which is written as a string.
fn is_typst_code(text: &str) -> bool {
    let trimmed = text.trim();

    if trimmed.is_empty() {
        return false;
    }

    if trimmed.starts_with('#') {
        return true;
    }

    // A quoted string is already code.
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return true;
    }

    // A call, e.g. `rgb("#3355ff")`.
    let head = trimmed.split('(').next().unwrap_or_default();
    if trimmed.contains('(')
        && !head.is_empty()
        && head.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
        && head
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
    {
        return true;
    }

    // A number with a unit, e.g. `12pt`.
    let number = trimmed
        .trim_end_matches(|character: char| character.is_ascii_alphabetic() || character == '%');
    if !number.is_empty() && number.parse::<f64>().is_ok() {
        return true;
    }

    matches!(trimmed, "none" | "auto" | "true" | "false")
}

/// Turns a string into the Typst code that stands for it.
fn typst_string(text: &str) -> String {
    let trimmed = text.trim();

    if is_typst_code(trimmed) {
        return trimmed.to_string();
    }

    format!("\"{}\"", trimmed.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The place in a theme where a new style belongs.
///
/// A style only applies to the document when it is inside the `theme`
/// function and before the body it wraps, because a `set` rule applies to
/// the content that follows it. A style that is added after the function
/// would be read but never reach the document, so that is where a new style
/// is put.
///
/// The place given is the start of the line the body stands on, together
/// with the indentation of that line, so that a rule is written on a line of
/// its own in the same shape as the rest of the theme.
fn theme_insertion_point(text: &str) -> Option<(usize, String)> {
    let source = Source::detached(text);
    let linked = LinkedNode::new(source.root());

    let body = find_body(&linked)?;

    // The line the body stands on, without its indentation.
    let line_start = text[..body].rfind('\n').map(|index| index + 1).unwrap_or(0);
    let indent = text[line_start..body]
        .chars()
        .take_while(|character| character.is_whitespace())
        .collect::<String>();

    Some((line_start, indent))
}

/// The place of the body the theme function wraps.
///
/// The theme function is the binding named `theme`, and the body is the
/// parameter it is given, whatever the parameter is called.
fn find_body(node: &LinkedNode) -> Option<usize> {
    for child in node.children() {
        if child.get().kind() != SyntaxKind::LetBinding {
            continue;
        }

        let Some(name) = binding_name(&child) else {
            continue;
        };

        if name != "theme" {
            continue;
        }

        let closure = child
            .children()
            .find(|grandchild| grandchild.get().kind() == SyntaxKind::Closure)?;

        let parameter = closure
            .children()
            .find(|grandchild| grandchild.get().kind() == SyntaxKind::Params)?
            .children()
            .find(|grandchild| grandchild.get().kind() == SyntaxKind::Ident)?
            .get()
            .leaf_text()
            .to_string();

        return find_body_in_closure(&closure, &parameter);
    }

    None
}

/// The place of the body inside the body of the theme function.
fn find_body_in_closure(node: &LinkedNode, parameter: &str) -> Option<usize> {
    for child in node.children() {
        if child.get().kind() != SyntaxKind::CodeBlock {
            continue;
        }

        for grandchild in child.children() {
            if grandchild.get().kind() != SyntaxKind::Code {
                continue;
            }

            for word in grandchild.children() {
                if word.get().kind() == SyntaxKind::Ident
                    && word.get().leaf_text().as_str() == parameter
                {
                    return Some(word.offset());
                }
            }
        }
    }

    None
}

/// The declarations of a style into Typst code.
fn declarations_code(value: &Value) -> Result<String, ToolError> {
    match value {
        Value::String(text) => Ok(text.trim().to_string()),
        Value::Object(entries) => {
            let parts: Vec<String> = entries
                .iter()
                .map(|(name, value)| format!("{name}: {}", typst_value(value)))
                .collect();
            Ok(parts.join(", "))
        }
        _ => Err("The 'declarations' of a style have to be text or an object.".to_string()),
    }
}

/// Whether the code refers to the `it` of a show rule.
fn refers_to_it(code: &str) -> bool {
    /// Whether the node is the `it` of a show rule.
    fn is_it(node: &typst::syntax::SyntaxNode) -> bool {
        node.kind() == SyntaxKind::Ident && node.leaf_text().as_str() == "it"
    }

    /// Whether the node holds the `it` of a show rule.
    fn holds_it(node: &typst::syntax::SyntaxNode) -> bool {
        if is_it(node) {
            return true;
        }

        node.children().any(|child| {
            // The name of an argument is a name, not a reference to a value,
            // so only the value of the argument is looked at.
            if child.kind() == SyntaxKind::Named {
                let mut after_colon = false;

                return child.children().any(|part| {
                    if part.kind() == SyntaxKind::Colon {
                        after_colon = true;
                        return false;
                    }

                    after_colon && holds_it(part)
                });
            }

            holds_it(child)
        })
    }

    holds_it(&typst::syntax::parse_code(code))
}

/// The recipe a show rule needs.
///
/// A show rule replaces what it shows with the result of a recipe, and the
/// recipe takes the shown content as `it`. A recipe that is written as a
/// plain call and uses `it` is therefore turned into a closure, so that
/// `block(above: 0pt, it)` becomes `it => block(above: 0pt, it)`.
fn show_recipe(declarations: &str) -> String {
    let trimmed = declarations.trim();
    let root = typst::syntax::parse_code(trimmed);

    let is_closure = root
        .children()
        .any(|child| child.kind() == SyntaxKind::Closure);

    if is_closure || !refers_to_it(trimmed) {
        return trimmed.to_string();
    }

    format!("it => {trimmed}")
}

/// Proposes a change to a style in the project's theme.
fn tool_propose_style(context: &mut ToolContext, arguments: &Value) -> Result<Value, ToolError> {
    let selector = string_argument(arguments, "selector")
        .ok_or_else(|| "A 'selector' is needed to set a style.".to_string())?;

    let declarations = arguments
        .get("declarations")
        .ok_or_else(|| "The 'declarations' of a style have to be text or an object.".to_string())?;
    let declarations = declarations_code(declarations)?;

    let path = match string_argument(arguments, "path") {
        Some(path) => path,
        None => context
            .project
            .theme
            .clone()
            .map(|theme| theme.trim().to_string())
            .filter(|theme| !theme.is_empty())
            .ok_or_else(|| "This project has no theme to change.".to_string())?,
    };

    let old_text = context.file_text(&path);
    if old_text.trim().is_empty() {
        return Err(format!("There is no theme at '{path}' in this project."));
    }

    let (kind, name) = parse_selector(&selector);

    // A bare name is looked for in every kind of style, so that `heading`
    // finds a show rule as well as a set rule.
    let target = match kind {
        Some(kind) => find_style(&old_text, kind, &name),
        None => find_style(&old_text, StyleKind::Show, &name)
            .or_else(|| find_style(&old_text, StyleKind::Set, &name))
            .or_else(|| find_style(&old_text, StyleKind::Let, &name)),
    };

    let new_text = match target {
        Some(StyleTarget::Set(range)) => {
            format!(
                "{}({declarations}){}",
                &old_text[..range.start],
                &old_text[range.end..]
            )
        }
        Some(StyleTarget::Show(range)) => {
            let recipe = show_recipe(&declarations);
            format!(
                "{}{recipe}{}",
                &old_text[..range.start],
                &old_text[range.end..]
            )
        }
        Some(StyleTarget::Let(range)) => {
            format!(
                "{}{declarations}{}",
                &old_text[..range.start],
                &old_text[range.end..]
            )
        }
        None => {
            // A binding is read wherever it is used, so it goes next to the
            // theme function. A rule applies to the content that follows it,
            // so it goes inside the theme function, in front of the body it
            // wraps.
            let inside = !matches!(kind, Some(StyleKind::Let));

            // Inside the theme function the code is already code, so it is
            // written without the `#` that marks code in the file itself.
            let rule = match kind {
                Some(StyleKind::Let) => format!("#let {name} = {declarations}"),
                Some(StyleKind::Show) => {
                    let recipe = show_recipe(&declarations);
                    format!("#show {name}: {recipe}")
                }
                Some(StyleKind::Set) => format!("#set {name}({declarations})"),
                None => format!("#set {name}({declarations})"),
            };

            let rule = if inside {
                rule.trim_start_matches('#').to_string()
            } else {
                rule
            };

            let point = if inside {
                theme_insertion_point(&old_text)
            } else {
                None
            };

            match point {
                // The rule goes in front of the body the theme function
                // wraps, so that it reaches the document.
                Some((point, indent)) => {
                    format!(
                        "{}{indent}{rule}\n{}",
                        &old_text[..point],
                        &old_text[point..]
                    )
                }
                // There is no body to go in front of, so the rule is added at
                // the end of the file.
                None => {
                    let separator = if old_text.ends_with("\n\n") {
                        ""
                    } else if old_text.ends_with('\n') {
                        "\n"
                    } else {
                        "\n\n"
                    };
                    format!("{old_text}{separator}{rule}\n")
                }
            }
        }
    };

    if let Some(reason) = refusal_reason(context, &path, &new_text) {
        return Err(refused_change(&path, &reason));
    }

    let edit = context.propose(&path, &old_text, &new_text, "replace");

    Ok(json!({
        "path": path,
        "selector": selector,
        "hunks": edit.hunks.len(),
    }))
}

/// Renders the document and reports what the renderer found.
fn tool_render_preview(context: &ToolContext, _arguments: &Value) -> Result<Value, ToolError> {
    let rendered = crate::render::render_project(&context.render_request())
        .map_err(|error| format!("The document could not be rendered: {error}"))?;

    let outline: Vec<Value> = rendered
        .outline
        .entries
        .iter()
        .map(|entry| {
            json!({
                "title": entry.title,
                "level": entry.level,
                "page": entry.page,
                "anchor": entry.anchor,
                "children": entry.children,
            })
        })
        .collect();

    let warnings: Vec<Value> = rendered
        .warnings
        .iter()
        .map(|warning| {
            json!({
                "code": warning.code,
                "message": warning.message,
                "path": warning.path,
            })
        })
        .collect();

    Ok(json!({
        "pageCount": rendered.outline.page_count,
        "outline": outline,
        "warnings": warnings,
    }))
}

/// Runs one tool call.
///
/// Returns whether it succeeded, what it produced and, when it did not, why.
pub fn run_tool(
    context: &mut ToolContext,
    name: &str,
    arguments: Option<&Value>,
) -> (bool, Option<Value>, Option<String>) {
    let arguments = arguments_of(arguments);

    let outcome = match name {
        "list_sections" => tool_list_sections(context, &arguments),
        "read_section" => tool_read_section(context, &arguments),
        "search" => tool_search(context, &arguments),
        "propose_edit" => tool_propose_edit(context, &arguments),
        "propose_style" => tool_propose_style(context, &arguments),
        "render_preview" => tool_render_preview(context, &arguments),
        _ => {
            return (
                false,
                None,
                Some(format!("There is no tool called '{name}'.")),
            );
        }
    };

    match outcome {
        Ok(result) => (true, Some(result), None),
        Err(error) => (false, None, Some(error)),
    }
}

/// What a tool call produced.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallResult {
    /// The call's identifier.
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The arguments the call was given.
    #[serde(default)]
    pub arguments: Value,
    /// Whether the call worked.
    pub ok: bool,
    /// What the call produced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Why the call failed, when it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The result of a session of tool calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSession {
    /// The session's identifier.
    pub id: String,
    /// What each call produced.
    pub calls: Vec<ToolCallResult>,
    /// The changes the session proposed.
    #[serde(default)]
    pub edits: Vec<ProposedEdit>,
}

// The command wrappers the webview calls. The logic lives in the plain
// functions above so it can be tested without a Tauri runtime.

/// Lists the tools the assistant may call.
///
/// The app sends this to the model provider, so the assistant is told what
/// it may do rather than what the user typed.
#[tauri::command(rename = "list_ai_tools")]
pub fn command_list_ai_tools() -> Vec<ToolDefinition> {
    tool_descriptions()
}

/// Runs a session of tool calls against a project.
///
/// The calls run on the project's own files, with no access to the user's
/// disk. The changes the calls propose come back for the user to accept or
/// reject.
///
/// A session can render the document, which takes a moment, so the work is
/// put on a blocking thread rather than freezing the window.
#[tauri::command(rename = "run_ai_session")]
pub async fn command_run_ai_session(
    project: Project,
    files: Vec<ProjectFile>,
    assets: Vec<ProjectAsset>,
    fonts: Vec<ProjectFont>,
    calls: Vec<crate::providers::ToolCall>,
) -> Result<ToolSession, String> {
    tokio::task::spawn_blocking(move || run_session(project, files, assets, fonts, &calls))
        .await
        .map_err(|error| format!("The tools did not run: {error}"))
}

/// Runs the calls of a session and collects what they produced.
///
/// A call that fails does not stop the session: the answer is recorded with
/// the reason, so the assistant can try something else.
pub fn run_session(
    project: Project,
    files: Vec<ProjectFile>,
    assets: Vec<ProjectAsset>,
    fonts: Vec<ProjectFont>,
    calls: &[crate::providers::ToolCall],
) -> ToolSession {
    let mut context = ToolContext::new(project, files, assets, fonts);
    let mut results = Vec::new();

    for call in calls {
        let arguments = arguments_of(Some(&call.arguments));
        let (ok, result, error) = run_tool(&mut context, &call.name, Some(&arguments));
        results.push(ToolCallResult {
            id: call.id.clone(),
            name: call.name.clone(),
            arguments,
            ok,
            result,
            error,
        });
    }

    ToolSession {
        id: "session-1".to_string(),
        calls: results,
        edits: context.edits,
    }
}

/// The tools the assistant can use, each with the schema of its arguments.
pub fn tool_descriptions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "list_sections".to_string(),
            description:
                "List the headings of the document, in document order, with the file each one is in and the line it is on."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Limit the list to one file.",
                    }
                },
            }),
        },
        ToolDefinition {
            name: "read_section".to_string(),
            description:
                "Read a section of the document by its heading, or a range of lines of a file."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The file to read." },
                    "heading": {
                        "type": "string",
                        "description": "The heading of the section to read.",
                    },
                    "startLine": {
                        "type": "integer",
                        "description": "The first line to read.",
                    },
                    "endLine": {
                        "type": "integer",
                        "description": "The last line to read.",
                    },
                },
                "required": ["path"],
            }),
        },
        ToolDefinition {
            name: "search".to_string(),
            description: "Search the project's text files for a string.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The text to look for." },
                    "path": {
                        "type": "string",
                        "description": "Limit the search to one file.",
                    },
                    "caseSensitive": {
                        "type": "boolean",
                        "description": "Whether the search respects case.",
                    },
                },
                "required": ["query"],
            }),
        },
        ToolDefinition {
            name: "propose_edit".to_string(),
            description:
                "Propose a new version of a Typst file. The user sees the difference and decides whether to accept it."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The file to change." },
                    "newText": {
                        "type": "string",
                        "description": "The file's new contents.",
                    },
                },
                "required": ["path", "newText"],
            }),
        },
        ToolDefinition {
            name: "propose_style".to_string(),
            description:
                "Propose a change to a style in the project's theme, either changing a style that is already there or adding one. The theme is a Typst file, so the declarations are Typst code."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "The style to change, e.g. 'text', 'heading' or 'let accent'.",
                    },
                    "declarations": {
                        "description": "The declarations to set, as Typst code.",
                    },
                    "path": {
                        "type": "string",
                        "description": "The theme file to change.",
                    },
                },
                "required": ["selector", "declarations"],
            }),
        },
        ToolDefinition {
            name: "render_preview".to_string(),
            description:
                "Render the document and report the page count, the outline and any warnings the renderer found."
                    .to_string(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
    ]
}

/// The names of the tools the assistant can use, in the order they are
/// offered.
pub fn tool_names() -> Vec<String> {
    tool_descriptions()
        .into_iter()
        .map(|tool| tool.name)
        .collect()
}

/// The pairs of texts the fixture holds.
const FIXTURE_CASES: [(&str, &str); 4] = [
    ("one\ntwo\nthree\n", "one\nTWO\nthree\n"),
    (
        "= Title\n\nFirst paragraph.\n\nSecond paragraph.\n",
        "= Title\n\nFirst paragraph, edited.\n\nSecond paragraph.\n",
    ),
    (
        "one\ntwo\nthree\nfour\nfive\n",
        "one\ntwo\nthree\nfour\nfive\n",
    ),
    ("", "= A new file\n\nWith a paragraph.\n"),
];

/// One case of the shared fixture.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureCase {
    /// The file's contents before the change.
    pub old_text: String,
    /// The file's contents after the change.
    pub new_text: String,
    /// The differences between the two.
    pub hunks: Vec<DiffHunk>,
}

/// The contract the app and the renderer share, as a fixture.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fixture {
    /// The cases the fixture holds.
    pub cases: Vec<FixtureCase>,
    /// The names of the tools.
    pub tools: Vec<String>,
}

/// Builds the fixture's contents, with the renderer's own code.
pub fn build_fixture() -> Fixture {
    let cases = FIXTURE_CASES
        .iter()
        .map(|(old_text, new_text)| FixtureCase {
            old_text: (*old_text).to_string(),
            new_text: (*new_text).to_string(),
            hunks: diff_hunks(old_text, new_text, crate::diff::DEFAULT_CONTEXT),
        })
        .collect();

    Fixture {
        cases,
        tools: tool_names(),
    }
}

/// Writes the shared fixture to a file.
///
/// The app's test reads the file, so a difference between the two sides
/// shows up as a failing test rather than as a document that comes out
/// wrong.
pub fn write_assistant_fixture(path: &std::path::Path) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&build_fixture())
        .map_err(|error| format!("Cannot write the fixture: {error}"))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create '{}': {error}", parent.display()))?;
    }

    std::fs::write(path, format!("{text}\n"))
        .map_err(|error| format!("Cannot write '{}': {error}", path.display()))
}
