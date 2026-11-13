//! Tests for the failures a provider can report.
//!
//! The other provider tests read the frames of a good answer. These ones
//! look at what comes back when the provider says no, because the message
//! the user sees in that case is the only thing that tells them whether the
//! key is wrong, the model is unknown or the provider is unwell.

use crate::config::{ProviderConfig, ProviderProtocol};
use crate::testing::providers::{
    anthropic_headers, describe_failure, describe_transport_failure, endpoint_for, images_of,
    openai_headers, text_of,
};
use crate::testing::{ChatMessage, ContentPart};

/// A provider with the given address.
fn provider(base_url: &str) -> ProviderConfig {
    ProviderConfig {
        id: "mock".to_string(),
        name: "Mock".to_string(),
        protocol: ProviderProtocol::Openai,
        base_url: base_url.to_string(),
        model: "mock-model".to_string(),
        models: Vec::new(),
        supports_images: false,
        requires_key: true,
    }
}

// The status says what kind of failure it was.

#[test]
fn a_refused_key_is_reported_as_a_refused_key() {
    let message = describe_failure(401, r#"{"error":{"message":"Invalid API key"}}"#);

    assert!(
        message.contains("refused the key"),
        "the message: {message}"
    );
    assert!(message.contains("Invalid API key"), "the message: {message}");
}

#[test]
fn a_forbidden_request_is_reported_as_a_refused_request() {
    let message = describe_failure(403, "{}");

    assert!(
        message.contains("refused the request"),
        "the message: {message}"
    );
}

#[test]
fn an_unknown_endpoint_is_reported_as_such() {
    let message = describe_failure(404, "{}");

    assert!(
        message.contains("no such endpoint or model"),
        "the message: {message}"
    );
}

#[test]
fn a_rate_limited_request_is_reported_as_rate_limiting() {
    let message = describe_failure(429, "{}");

    assert!(
        message.contains("rate limiting"),
        "the message: {message}"
    );
}

#[test]
fn a_failure_of_the_provider_itself_says_so_and_names_the_status() {
    let message = describe_failure(503, "{}");

    assert!(
        message.contains("problem of its own"),
        "the message: {message}"
    );
    assert!(message.contains("503"), "the message: {message}");
}

#[test]
fn another_failure_names_the_status() {
    let message = describe_failure(418, "{}");

    assert!(
        message.contains("refused the request"),
        "the message: {message}"
    );
    assert!(message.contains("418"), "the message: {message}");
}

// The body says what the provider said about it.

#[test]
fn the_message_of_the_error_is_read() {
    let message = describe_failure(400, r#"{"error":{"message":"model not found"}}"#);

    assert!(message.contains("model not found"), "the message: {message}");
}

#[test]
fn a_message_at_the_top_level_is_read() {
    let message = describe_failure(400, r#"{"message":"the model is unknown"}"#);

    assert!(
        message.contains("the model is unknown"),
        "the message: {message}"
    );
}

#[test]
fn a_body_that_is_not_json_is_shown_as_it_came() {
    let message = describe_failure(400, "the server is on fire");

    assert!(message.contains("the server is on fire"), "the message: {message}");
}

#[test]
fn an_empty_body_leaves_the_message_without_a_detail() {
    let message = describe_failure(400, "");

    assert!(message.contains("refused the request"), "the message: {message}");
}

// A broken connection says nothing about the key, so the cause is kept.

#[tokio::test]
async fn a_transport_failure_keeps_the_context_and_the_cause() {
    // Nothing is listening on this port, so the connection is refused.
    let error = crate::testing::providers::client()
        .expect("a client")
        .get("http://127.0.0.1:1/")
        .send()
        .await
        .expect_err("the request should fail");

    let message = describe_transport_failure("Could not reach the provider", &error);

    assert!(
        message.starts_with("Could not reach the provider"),
        "the message: {message}"
    );
    assert!(
        message.len() > "Could not reach the provider: ".len(),
        "the message says nothing about why: {message}"
    );
}

// The endpoint and the headers.

#[test]
fn the_endpoint_has_no_trailing_slash() {
    let endpoint = endpoint_for(&provider("https://example.test/v1/"), None);

    assert_eq!(endpoint.base_url, "https://example.test/v1");
}

#[test]
fn the_endpoint_carries_the_key() {
    let endpoint = endpoint_for(
        &provider("https://example.test"),
        Some("a-key".to_string()),
    );

    assert_eq!(endpoint.api_key.as_deref(), Some("a-key"));
}

#[test]
fn the_anthropic_headers_carry_the_version() {
    let headers = anthropic_headers(None);

    let version = headers
        .iter()
        .find(|(name, _)| *name == "anthropic-version")
        .map(|(_, value)| value.clone());

    assert_eq!(version.as_deref(), Some("2023-06-01"));
}

#[test]
fn the_anthropic_headers_carry_the_key_only_when_there_is_one() {
    let with_key = anthropic_headers(Some("a-key"));
    let without_key = anthropic_headers(None);

    assert!(with_key.contains(&("x-api-key", "a-key".to_string())));
    assert!(!without_key.iter().any(|(name, _)| *name == "x-api-key"));
}

#[test]
fn the_openai_headers_carry_the_key_as_a_bearer() {
    let headers = openai_headers(Some("a-key"));

    assert!(headers.contains(&("authorization", "Bearer a-key".to_string())));
}

#[test]
fn the_openai_headers_carry_no_key_when_there_is_none() {
    let headers = openai_headers(None);

    assert!(!headers.iter().any(|(name, _)| *name == "authorization"));
}

// The parts of a message.

#[test]
fn the_text_of_a_message_joins_its_text_parts() {
    let message = ChatMessage {
        role: "user".to_string(),
        content: vec![
            ContentPart::Text {
                text: "first".to_string(),
            },
            ContentPart::Text {
                text: "second".to_string(),
            },
        ],
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
    };

    assert_eq!(text_of(&message), "first\nsecond");
}

#[test]
fn the_text_of_a_message_leaves_out_the_images() {
    let message = ChatMessage {
        role: "user".to_string(),
        content: vec![
            ContentPart::Text {
                text: "look".to_string(),
            },
            ContentPart::Image {
                base64: "aGk=".to_string(),
                mime_type: "image/png".to_string(),
            },
        ],
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
    };

    assert_eq!(text_of(&message), "look");
}

#[test]
fn the_images_of_a_message_are_the_image_parts() {
    let message = ChatMessage {
        role: "user".to_string(),
        content: vec![
            ContentPart::Text {
                text: "look".to_string(),
            },
            ContentPart::Image {
                base64: "aGk=".to_string(),
                mime_type: "image/png".to_string(),
            },
        ],
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
    };

    let images = images_of(&message);

    assert_eq!(images.len(), 1);
    assert!(matches!(images[0], ContentPart::Image { .. }));
}

#[test]
fn a_message_of_text_has_no_images() {
    let message = ChatMessage::text("user", "nothing to see");

    assert!(images_of(&message).is_empty());
}
