//! Tests for the assistant's run.

use crate::assistant::Agent;
use crate::testing::{CancelFlag, ToolCall};
use serde_json::json;

/// A tool call with the given name and arguments.
fn call(name: &str, arguments: serde_json::Value) -> ToolCall {
    ToolCall {
        id: "call_1".to_string(),
        name: name.to_string(),
        arguments,
    }
}

#[test]
fn a_stylesheet_change_affects_the_layout() {
    assert!(Agent::changes_layout(&call(
        "propose_edit",
        json!({ "path": "styles/main.css" })
    )));
}

#[test]
fn a_markdown_change_does_not_affect_the_layout() {
    assert!(!Agent::changes_layout(&call(
        "propose_edit",
        json!({ "path": "chapters/intro.md" })
    )));
}

#[test]
fn setting_a_style_affects_the_layout() {
    assert!(Agent::changes_layout(&call("set_style", json!({}))));
}

#[test]
fn reading_does_not_affect_the_layout() {
    assert!(!Agent::changes_layout(&call(
        "read_section",
        json!({ "path": "chapters/intro.md" })
    )));
}

#[test]
fn the_cancel_flag_starts_clear_and_can_be_set() {
    let flag = CancelFlag::default();

    assert!(!flag.is_cancelled());

    flag.cancel();
    assert!(flag.is_cancelled());

    flag.reset();
    assert!(!flag.is_cancelled());
}
