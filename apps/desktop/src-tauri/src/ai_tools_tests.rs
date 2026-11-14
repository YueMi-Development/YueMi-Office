//! Tests for the assistant's tools.

use serde_json::json;

use crate::ai_tools::{
    ToolContext, build_fixture, find_sections, run_session, run_tool, tool_names,
};
use crate::providers::ToolCall;
use crate::render::{Project, ProjectFile};

/// A tool context over a small project.
fn make_context(files: Option<Vec<ProjectFile>>) -> ToolContext {
    let project = Project {
        schema_version: 3,
        title: "Tool Test".to_string(),
        language: "en".to_string(),
        content: vec!["content/intro.typ".to_string()],
        theme: Some("theme.typ".to_string()),
        fonts: None,
        assets_dir: "assets".to_string(),
        page: Default::default(),
        pdf: Default::default(),
    };

    let defaults = vec![
        ProjectFile {
            path: "content/intro.typ".to_string(),
            text: "= Getting Started\n\nThe opening paragraph.\n\n== Installation\n\nRun the installer.\n\n== Usage\n\nRun the command.\n".to_string(),
        },
        ProjectFile {
            path: "theme.typ".to_string(),
            text: "#let theme(body) = {\n  set text(font: \"Inter\")\n  body\n}\n".to_string(),
        },
    ];

    ToolContext::new(project, files.unwrap_or(defaults), Vec::new(), Vec::new())
}

#[test]
fn finds_the_headings_of_a_file() {
    let sections = find_sections("content/a.typ", "= One\n\ntext\n\n== Two\n");

    assert_eq!(
        sections
            .iter()
            .map(|section| section.title.as_str())
            .collect::<Vec<_>>(),
        vec!["One", "Two"]
    );
    assert_eq!(sections[0].level, 1);
    assert_eq!(sections[1].level, 2);
}

#[test]
fn a_section_ends_at_the_next_heading_of_the_same_level() {
    let text = "= One\n\nfirst\n\n= Two\n\nsecond\n";

    let sections = find_sections("content/a.typ", text);

    assert_eq!(sections[0].end_line, 4);
    assert_eq!(sections[1].line, 5);
}

#[test]
fn a_subheading_belongs_to_its_parent() {
    let text = "= One\n\nintro\n\n== Sub\n\nsub text\n";

    let sections = find_sections("content/a.typ", text);

    assert_eq!(sections[0].title, "One");
    assert_eq!(sections[0].end_line, 8);
    assert_eq!(sections[1].title, "Sub");
}

#[test]
fn lists_the_sections_of_the_document() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(&mut context, "list_sections", Some(&json!({})));

    assert!(ok, "{error:?}");
    let titles: Vec<String> = result
        .unwrap()
        .get("sections")
        .and_then(|sections| sections.as_array())
        .unwrap()
        .iter()
        .map(|section| section.get("title").unwrap().as_str().unwrap().to_string())
        .collect();

    assert_eq!(titles, vec!["Getting Started", "Installation", "Usage"]);
}

#[test]
fn the_sections_carry_their_file() {
    let mut context = make_context(None);

    let (ok, result, _error) = run_tool(&mut context, "list_sections", Some(&json!({})));

    assert!(ok);
    let sections = result.unwrap();
    let sections = sections
        .get("sections")
        .and_then(|value| value.as_array())
        .unwrap();
    assert!(
        sections
            .iter()
            .all(|section| section.get("path").unwrap().as_str() == Some("content/intro.typ"))
    );
}

#[test]
fn reads_a_section_by_its_heading() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(
        &mut context,
        "read_section",
        Some(&json!({ "path": "content/intro.typ", "heading": "Installation" })),
    );

    assert!(ok, "{error:?}");
    let result = result.unwrap();
    let text = result.get("text").unwrap().as_str().unwrap();
    assert!(text.contains("Run the installer."));
    assert!(!text.contains("Run the command."));
}

#[test]
fn reads_a_range_of_lines() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(
        &mut context,
        "read_section",
        Some(&json!({ "path": "content/intro.typ", "startLine": 1, "endLine": 3 })),
    );

    assert!(ok, "{error:?}");
    let result = result.unwrap();
    assert_eq!(
        result.get("text").unwrap().as_str().unwrap(),
        "= Getting Started\n\nThe opening paragraph."
    );
}

#[test]
fn reports_a_missing_file() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "read_section",
        Some(&json!({ "path": "content/nope.typ", "heading": "x" })),
    );

    assert!(!ok);
    assert!(error.unwrap().contains("content/nope.typ"));
}

#[test]
fn reports_a_missing_heading() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "read_section",
        Some(&json!({ "path": "content/intro.typ", "heading": "Nope" })),
    );

    assert!(!ok);
    assert!(error.unwrap().contains("Nope"));
}

#[test]
fn finds_the_matching_lines() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(
        &mut context,
        "search",
        Some(&json!({ "query": "installer" })),
    );

    assert!(ok, "{error:?}");
    let result = result.unwrap();
    assert_eq!(result.get("count").unwrap().as_u64(), Some(1));
    let matches = result
        .get("matches")
        .and_then(|value| value.as_array())
        .unwrap();
    assert_eq!(matches[0].get("line").unwrap().as_u64(), Some(7));
}

#[test]
fn ignores_case_by_default() {
    let mut context = make_context(None);

    let (ok, result, _error) = run_tool(
        &mut context,
        "search",
        Some(&json!({ "query": "INSTALLER" })),
    );

    assert!(ok);
    assert_eq!(result.unwrap().get("count").unwrap().as_u64(), Some(1));
}

#[test]
fn respects_case_when_asked_to() {
    let mut context = make_context(None);

    let (ok, result, _error) = run_tool(
        &mut context,
        "search",
        Some(&json!({ "query": "INSTALLER", "caseSensitive": true })),
    );

    assert!(ok);
    assert_eq!(result.unwrap().get("count").unwrap().as_u64(), Some(0));
}

#[test]
fn searches_the_theme_too() {
    let mut context = make_context(None);

    let (ok, result, _error) = run_tool(&mut context, "search", Some(&json!({ "query": "font" })));

    assert!(ok);
    let result = result.unwrap();
    let matches = result
        .get("matches")
        .and_then(|value| value.as_array())
        .unwrap();
    assert_eq!(matches[0].get("path").unwrap().as_str(), Some("theme.typ"));
}

#[test]
fn records_the_change_and_its_difference() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(
        &mut context,
        "propose_edit",
        Some(&json!({
            "path": "content/intro.typ",
            "newText": "= Getting Started\n\nThe opening paragraph.\n",
        })),
    );

    assert!(ok, "{error:?}");
    assert_eq!(
        result.unwrap().get("kind").unwrap().as_str(),
        Some("replace")
    );
    assert_eq!(context.edits.len(), 1);
    assert!(!context.edits[0].hunks.is_empty());
}

#[test]
fn a_new_file_is_reported_as_created() {
    let mut context = make_context(None);

    let (ok, result, _error) = run_tool(
        &mut context,
        "propose_edit",
        Some(&json!({ "path": "content/new.typ", "newText": "= New\n" })),
    );

    assert!(ok);
    assert_eq!(
        result.unwrap().get("kind").unwrap().as_str(),
        Some("create")
    );
}

#[test]
fn the_change_is_not_applied_to_the_file() {
    let mut context = make_context(None);
    let before = context.file_text("content/intro.typ");

    run_tool(
        &mut context,
        "propose_edit",
        Some(&json!({ "path": "content/intro.typ", "newText": "= Replaced\n" })),
    );

    assert_eq!(context.file_text("content/intro.typ"), before);
}

#[test]
fn changes_the_body_of_an_existing_style() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({
            "selector": "text",
            "declarations": "font: \"Lato\"",
        })),
    );

    assert!(ok, "{error:?}");
    assert_eq!(
        result.unwrap().get("path").unwrap().as_str(),
        Some("theme.typ")
    );
    let new_text = &context.edits[0].new_text;
    assert!(new_text.contains("font: \"Lato\""));
    assert!(!new_text.contains("font: \"Inter\""));
}

#[test]
fn adds_a_style_that_is_not_there_yet() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({
            "selector": "heading",
            "declarations": "numbered: true",
        })),
    );

    assert!(ok, "{error:?}");
    let new_text = &context.edits[0].new_text;
    assert!(new_text.contains("#set heading(numbered: true)"));
}

#[test]
fn adds_a_binding_that_is_not_there_yet() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({
            "selector": "let accent",
            "declarations": "rgb(\"#3355ff\")",
        })),
    );

    assert!(ok, "{error:?}");
    let new_text = &context.edits[0].new_text;
    assert!(new_text.contains("#let accent = rgb(\"#3355ff\")"));
}

#[test]
fn changes_an_existing_binding() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({
            "selector": "let accent",
            "declarations": "rgb(\"#ff0000\")",
        })),
    );

    assert!(ok, "{error:?}");
    let new_text = &context.edits[0].new_text;
    assert!(new_text.contains("rgb(\"#ff0000\")"));
}

#[test]
fn reports_a_missing_selector() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({ "declarations": {} })),
    );

    assert!(!ok);
    assert!(error.unwrap().contains("selector"));
}

#[test]
fn reports_declarations_that_are_neither_text_nor_an_object() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(
        &mut context,
        "propose_style",
        Some(&json!({ "selector": "text", "declarations": 12 })),
    );

    assert!(!ok);
    assert!(error.unwrap().contains("declarations"));
}

#[test]
fn reports_the_page_count_and_the_outline() {
    let mut context = make_context(None);

    let (ok, result, error) = run_tool(&mut context, "render_preview", Some(&json!({})));

    assert!(ok, "{error:?}");
    let result = result.unwrap();
    assert!(result.get("pageCount").unwrap().as_u64().unwrap() >= 1);
    assert!(
        !result
            .get("outline")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn reports_a_tool_that_does_not_exist() {
    let mut context = make_context(None);

    let (ok, _result, error) = run_tool(&mut context, "delete_everything", Some(&json!({})));

    assert!(!ok);
    assert!(error.unwrap().contains("delete_everything"));
}

#[test]
fn runs_the_calls_in_order() {
    let context = make_context(None);

    let result = run_session(
        context.project.clone(),
        context.files.clone(),
        Vec::new(),
        Vec::new(),
        &[
            ToolCall {
                id: "1".to_string(),
                name: "list_sections".to_string(),
                arguments: json!({}),
            },
            ToolCall {
                id: "2".to_string(),
                name: "search".to_string(),
                arguments: json!({ "query": "installer" }),
            },
        ],
    );

    let names: Vec<String> = result.calls.iter().map(|call| call.name.clone()).collect();
    assert_eq!(names, vec!["list_sections", "search"]);
    assert!(result.calls.iter().all(|call| call.ok));
}

#[test]
fn a_failing_call_does_not_stop_the_session() {
    let context = make_context(None);

    let result = run_session(
        context.project.clone(),
        context.files.clone(),
        Vec::new(),
        Vec::new(),
        &[
            ToolCall {
                id: "1".to_string(),
                name: "read_section".to_string(),
                arguments: json!({ "path": "nope.typ" }),
            },
            ToolCall {
                id: "2".to_string(),
                name: "list_sections".to_string(),
                arguments: json!({}),
            },
        ],
    );

    assert!(!result.calls[0].ok);
    assert!(result.calls[1].ok);
}

#[test]
fn collects_the_changes_the_session_proposed() {
    let context = make_context(None);

    let result = run_session(
        context.project.clone(),
        context.files.clone(),
        Vec::new(),
        Vec::new(),
        &[ToolCall {
            id: "1".to_string(),
            name: "propose_edit".to_string(),
            arguments: json!({ "path": "content/intro.typ", "newText": "= New\n" }),
        }],
    );

    assert_eq!(result.edits.len(), 1);
    assert_eq!(result.edits[0].path, "content/intro.typ");
}

#[test]
fn the_fixture_holds_the_tools_the_assistant_offers() {
    let fixture = build_fixture();

    assert_eq!(fixture.tools, tool_names());
    assert_eq!(
        fixture.tools,
        vec![
            "list_sections",
            "read_section",
            "search",
            "propose_edit",
            "propose_style",
            "render_preview",
        ]
    );
}

#[test]
fn the_fixture_applies_back_to_the_old_text() {
    let fixture = build_fixture();

    for case in &fixture.cases {
        let changes: Vec<crate::diff::DiffChange> = case
            .hunks
            .iter()
            .flat_map(|hunk| hunk.changes.iter().cloned())
            .collect();

        assert_eq!(
            crate::diff::apply_changes(&case.old_text, &changes),
            case.new_text
        );
    }
}
