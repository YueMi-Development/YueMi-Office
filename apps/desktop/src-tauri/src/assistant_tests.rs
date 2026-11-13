//! Tests for the assistant's run.

use crate::assistant::Agent;
use crate::config::{AppConfig, ProviderConfig, ProviderProtocol};
use crate::testing::{CancelFlag, ToolCall, provider_key_in, set_provider_key_in, write_config_to};
use serde_json::json;

use tempfile::TempDir;

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

// Which provider a run talks to.

/// A provider with the given identifier and name.
fn provider(id: &str, name: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.to_string(),
        name: name.to_string(),
        protocol: ProviderProtocol::Openai,
        base_url: "https://example.test/v1".to_string(),
        model: "a-model".to_string(),
        models: Vec::new(),
        supports_images: false,
        requires_key: true,
    }
}

/// A folder holding the given providers and keys.
fn settings(providers: Vec<ProviderConfig>, keys: &[&str]) -> TempDir {
    let directory = TempDir::new().expect("a temporary folder");

    let config = AppConfig {
        providers,
        active_provider_id: None,
        active_model: None,
        ai_enabled: true,
    };

    write_config_to(directory.path(), &config).expect("the configuration is written");

    for key in keys {
        set_provider_key_in(directory.path(), key, Some("a-key")).expect("the key is set");
    }

    directory
}

/// A request that names no provider and no model.
fn request(provider_id: Option<&str>, model: Option<&str>) -> crate::testing::ChatRequest {
    crate::testing::ChatRequest {
        messages: Vec::new(),
        project: json!({ "root": "test" }),
        files: Vec::new(),
        assets: Vec::new(),
        fonts: Vec::new(),
        service_url: "http://127.0.0.1:32100".to_string(),
        provider_id: provider_id.map(str::to_string),
        model: model.map(str::to_string),
        mode: None,
    }
}

#[test]
fn the_provider_the_user_picked_is_the_one_used() {
    let directory = settings(
        vec![provider("first", "First"), provider("second", "Second")],
        &["first", "second"],
    );

    let (chosen, key) = Agent::choose_provider(directory.path(), &request(Some("second"), None))
        .expect("the provider");

    assert_eq!(chosen.id, "second");
    assert_eq!(key.as_deref(), Some("a-key"));
}

#[test]
fn without_a_choice_the_first_provider_with_a_key_is_used() {
    let directory = settings(
        vec![provider("first", "First"), provider("second", "Second")],
        &["second"],
    );

    let (chosen, _) =
        Agent::choose_provider(directory.path(), &request(None, None)).expect("the provider");

    assert_eq!(chosen.id, "second");
}

#[test]
fn a_provider_that_does_not_exist_is_reported_by_name() {
    let directory = settings(vec![provider("first", "First")], &["first"]);

    let error = Agent::choose_provider(directory.path(), &request(Some("nope"), None))
        .expect_err("there is no such provider");

    assert!(
        error.contains("There is no provider called 'nope'."),
        "the message: {error}"
    );
}

#[test]
fn a_provider_without_a_key_is_not_used_without_a_choice() {
    let directory = settings(vec![provider("first", "First")], &[]);

    let error = Agent::choose_provider(directory.path(), &request(None, None))
        .expect_err("no provider is set up");

    assert!(
        error.contains("No provider is set up"),
        "the message: {error}"
    );
}

// Which model a run uses.

#[test]
fn the_model_the_request_names_is_used() {
    let chosen = provider("first", "First");

    let model = Agent::choose_model(&request(None, Some("the-request-model")), &chosen);

    assert_eq!(model, "the-request-model");
}

#[test]
fn the_providers_own_model_is_used_when_the_request_names_none() {
    let chosen = provider("first", "First");

    let model = Agent::choose_model(&request(None, None), &chosen);

    assert_eq!(model, "a-model");
}

#[test]
fn a_blank_model_name_is_treated_as_no_model() {
    let chosen = provider("first", "First");

    let model = Agent::choose_model(&request(None, Some("   ")), &chosen);

    assert_eq!(model, "a-model");
}

#[test]
fn no_model_anywhere_leaves_the_run_without_one() {
    let mut chosen = provider("first", "First");
    chosen.model = String::new();

    let model = Agent::choose_model(&request(None, None), &chosen);

    assert!(model.is_empty());
}

#[test]
fn the_key_of_a_provider_is_where_it_is_kept() {
    let directory = settings(vec![provider("first", "First")], &["first"]);

    assert_eq!(
        provider_key_in(directory.path(), "first").as_deref(),
        Some("a-key")
    );
    assert!(provider_key_in(directory.path(), "second").is_none());
}
