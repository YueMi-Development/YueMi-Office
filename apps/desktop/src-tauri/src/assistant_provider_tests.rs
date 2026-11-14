//! Trying a provider out, the way the settings dialog does.
//!
//! The dialog sends the provider as the user has it on screen rather than
//! the one that was last saved, so a change can be tried before it is
//! kept. These tests check that the draft is what is tried, and that the
//! reasons a provider cannot be tried are told apart.

use std::time::Duration;

use crate::config::{AppConfig, ProviderConfig, ProviderProtocol};
use crate::test_support::MockServer;
use crate::testing::{ProviderTest, set_provider_key_in, test_provider_in, write_config_to};

use tempfile::TempDir;

/// The answer of a provider that says it is ready.
const READY: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"ready\"}}]}\n\n";

/// The server that answers with a provider saying it is ready.
fn ready_server() -> MockServer {
    MockServer::start(vec![READY])
}

/// A provider that talks to the given server.
fn provider(base_url: &str) -> ProviderConfig {
    ProviderConfig {
        id: "mock".to_string(),
        name: "Mock".to_string(),
        protocol: ProviderProtocol::OpenaiCompatible,
        base_url: base_url.to_string(),
        model: "mock-model".to_string(),
        models: Vec::new(),
        supports_images: false,
        requires_key: false,
    }
}

/// A folder holding the given providers.
fn settings(providers: Vec<ProviderConfig>) -> TempDir {
    let directory = TempDir::new().expect("a temporary folder");

    let config = AppConfig {
        providers,
        active_provider_id: None,
        active_model: None,
        ai_enabled: true,
    };

    write_config_to(directory.path(), &config).expect("the configuration is written");

    directory
}

/// A provider to try, as the dialog sends it.
fn test_of(base_url: &str, model: &str) -> ProviderTest {
    ProviderTest {
        id: "mock".to_string(),
        name: "Mock".to_string(),
        protocol: ProviderProtocol::OpenaiCompatible,
        base_url: base_url.to_string(),
        model: model.to_string(),
        requires_key: false,
        api_key: None,
    }
}

/// The time a test gives a provider to answer.
fn patience() -> Duration {
    Duration::from_secs(10)
}

#[tokio::test]
async fn a_provider_that_answers_is_reported() {
    let server = ready_server();
    let directory = settings(vec![provider(&server.base_url)]);

    let answer = test_provider_in(
        directory.path(),
        &test_of(&server.base_url, "mock-model"),
        patience(),
    )
    .await
    .expect("the provider answers");

    assert!(answer.contains("ready"), "the answer is {answer}");
}
#[tokio::test]
async fn the_address_on_screen_is_the_one_that_is_tried() {
    // The address in the dialog is not the one that was saved, because the
    // user has just changed it and has not pressed Save yet.
    let server = ready_server();
    let directory = settings(vec![provider("http://127.0.0.1:1/v1")]);

    let answer = test_provider_in(
        directory.path(),
        &test_of(&server.base_url, "mock-model"),
        patience(),
    )
    .await
    .expect("the provider answers");

    assert!(answer.contains("ready"), "the answer is {answer}");
}

#[tokio::test]
async fn the_model_on_screen_is_the_one_that_is_asked_for() {
    let server = ready_server();
    let directory = settings(vec![provider(&server.base_url)]);

    test_provider_in(
        directory.path(),
        &test_of(&server.base_url, "another-model"),
        patience(),
    )
    .await
    .expect("the provider answers");

    let bodies = server.bodies_of("/chat/completions");
    assert!(
        bodies.iter().any(|body| body.contains("another-model")),
        "the request was {bodies:?}"
    );
}

#[tokio::test]
async fn a_provider_that_has_not_been_saved_can_still_be_tried() {
    // The provider is not in the configuration file, because the user has
    // added it and has not pressed Save yet.
    let server = ready_server();
    let directory = settings(Vec::new());

    let answer = test_provider_in(
        directory.path(),
        &test_of(&server.base_url, "mock-model"),
        patience(),
    )
    .await
    .expect("the provider answers");

    assert!(answer.contains("ready"), "the answer is {answer}");
}

#[tokio::test]
async fn a_provider_without_a_key_says_so() {
    let server = ready_server();
    let directory = settings(Vec::new());

    let mut test = test_of(&server.base_url, "mock-model");
    test.requires_key = true;

    let answer = test_provider_in(directory.path(), &test, patience())
        .await
        .expect_err("the provider has no key");

    assert!(answer.contains("no key"), "the reason is {answer}");
}

#[tokio::test]
async fn a_provider_with_a_key_is_tried_with_it() {
    let server = ready_server();
    let directory = settings(Vec::new());
    set_provider_key_in(directory.path(), "mock", Some("a-key")).expect("the key is set");

    let mut test = test_of(&server.base_url, "mock-model");
    test.requires_key = true;

    test_provider_in(directory.path(), &test, patience())
        .await
        .expect("the provider answers");

    // The key travels in a header rather than in the body.
    let heads = server.heads();
    assert!(
        heads.iter().any(|head| head.contains("a-key")),
        "the request heads were {heads:?}"
    );
}

#[tokio::test]
async fn a_key_that_has_only_been_typed_is_used() {
    // The key is in the form but has not been saved, so the shell has no key
    // of its own to give.
    let server = ready_server();
    let directory = settings(Vec::new());

    let mut test = test_of(&server.base_url, "mock-model");
    test.requires_key = true;
    test.api_key = Some("typed-key".to_string());

    test_provider_in(directory.path(), &test, patience())
        .await
        .expect("the provider answers");

    let heads = server.heads();
    assert!(
        heads.iter().any(|head| head.contains("typed-key")),
        "the request heads were {heads:?}"
    );
}

#[tokio::test]
async fn a_provider_without_an_address_says_so() {
    let directory = settings(Vec::new());

    let answer = test_provider_in(directory.path(), &test_of("  ", "mock-model"), patience())
        .await
        .expect_err("the provider has no address");

    assert!(answer.contains("no address"), "the reason is {answer}");
}

#[tokio::test]
async fn a_provider_that_never_answers_is_reported_as_a_timeout() {
    // The server takes longer than the test is willing to wait, so the
    // provider is given up on rather than waited for for ever.
    let server = MockServer::start_slowly(vec![READY], Duration::from_secs(30));
    let directory = settings(vec![provider(&server.base_url)]);

    let answer = test_provider_in(
        directory.path(),
        &test_of(&server.base_url, "mock-model"),
        Duration::from_millis(300),
    )
    .await
    .expect_err("the provider does not answer in time");

    assert!(answer.contains("did not answer"), "the reason is {answer}");
}

#[tokio::test]
async fn the_name_on_screen_is_the_one_that_is_reported() {
    let server = ready_server();
    let directory = settings(vec![provider(&server.base_url)]);

    let mut test = test_of(&server.base_url, "mock-model");
    test.name = "My provider".to_string();

    let answer = test_provider_in(directory.path(), &test, patience())
        .await
        .expect("the provider answers");

    assert!(answer.contains("My provider"), "the answer is {answer}");
}

#[test]
fn the_payload_the_webview_sends_is_read() {
    // The webview sends the fields in camel case and the wire format in
    // kebab case, because that is how the protocol names them.
    let payload = serde_json::json!({
        "id": "mock",
        "name": "My provider",
        "protocol": "openai-compatible",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "model": "llama3",
        "requiresKey": true,
        "apiKey": "a-key",
    });

    let test: ProviderTest = serde_json::from_value(payload).expect("the payload is read");

    assert_eq!(test.id, "mock");
    assert_eq!(test.protocol, ProviderProtocol::OpenaiCompatible);
    assert_eq!(test.base_url, "http://127.0.0.1:11434/v1");
    assert!(test.requires_key);
    assert_eq!(test.api_key.as_deref(), Some("a-key"));
}

#[test]
fn a_payload_without_a_key_is_read() {
    let payload = serde_json::json!({
        "id": "mock",
        "protocol": "anthropic",
    });

    let test: ProviderTest = serde_json::from_value(payload).expect("the payload is read");

    assert_eq!(test.protocol, ProviderProtocol::Anthropic);
    assert!(
        test.requires_key,
        "a provider needs a key unless it says otherwise"
    );
    assert!(test.api_key.is_none());
}
