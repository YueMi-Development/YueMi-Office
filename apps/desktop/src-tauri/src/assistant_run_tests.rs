//! The whole assistant run, from the model's first question to the answer.
//!
//! The other tests look at one piece at a time: the stream is read, the
//! tools are listed, the configuration is stored. This one puts a server on
//! the other end of everything and runs the agent loop against it, so the
//! pieces are seen working together: the tools come from the service, the
//! model asks for one, the service runs it, and the answer comes back
//! through the channel the webview listens to.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::config::{AppConfig, ProviderConfig, ProviderProtocol};
use crate::test_support::{asking_for_a_tool, MockServer, SESSION, TOOLS};
use crate::testing::{
    run_in, write_config_to, CancelFlag, ChatMessage, ChatRequest, MAX_TOOL_ROUNDS,
};

use tempfile::TempDir;

/// A provider that talks to the given server.
fn provider(base_url: &str) -> ProviderConfig {
    ProviderConfig {
        id: "mock".to_string(),
        name: "Mock".to_string(),
        protocol: ProviderProtocol::OpenaiCompatible,
        base_url: base_url.to_string(),
        model: "mock-model".to_string(),
        models: vec!["mock-model".to_string()],
        supports_images: false,
        requires_key: false,
    }
}

/// A folder holding a configuration with one provider.
fn settings(server: &MockServer) -> TempDir {
    let directory = TempDir::new().expect("a temporary folder");

    let config = AppConfig {
        providers: vec![provider(&server.base_url)],
        active_provider_id: Some("mock".to_string()),
        active_model: Some("mock-model".to_string()),
        ai_enabled: true,
    };

    write_config_to(directory.path(), &config).expect("the configuration is written");

    directory
}

/// A request that asks the assistant to read a section.
fn request(service_url: &str) -> ChatRequest {
    ChatRequest {
        messages: vec![ChatMessage::text("user", "What is the title?")],
        project: json!({ "root": "test", "title": "A document" }),
        files: vec![json!({ "path": "a.md", "text": "# The title" })],
        assets: Vec::new(),
        fonts: Vec::new(),
        service_url: service_url.to_string(),
        provider_id: Some("mock".to_string()),
        model: Some("mock-model".to_string()),
    }
}

/// A channel that keeps every event of a run.
fn event_channel() -> (Channel<crate::assistant::AssistantEvent>, Arc<Mutex<Vec<Value>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&events);

    let channel = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Json(text) = body {
            let value: Value = serde_json::from_str(&text).expect("the event as JSON");
            recorded.lock().expect("the events").push(value);
        }
        Ok(())
    });

    (channel, events)
}

/// The kinds of the events, in the order they came.
fn kinds(events: &[Value]) -> Vec<&str> {
    events
        .iter()
        .map(|event| event["type"].as_str().unwrap_or_default())
        .collect()
}

#[tokio::test]
async fn the_run_asks_the_model_runs_the_tool_and_answers() {
    let server = MockServer::start(
        vec![
            // The first turn asks for a tool.
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\
             \"function\":{\"name\":\"read_section\",\"arguments\":\"{\\\"path\\\":\\\"a.md\\\"}\"}}]}}]}\n\n\
\n",
            // The second turn answers.
            "data: {\"choices\":[{\"delta\":{\"content\":\"The title is The title.\"}}]}\n\n\
             data: [DONE]\n\n",
        ],
        TOOLS,
        SESSION,
    );

    let directory = settings(&server);
    let (channel, events) = event_channel();

    run_in(
        directory.path(),
        request(&server.base_url),
        channel,
        CancelFlag::default(),
    )
    .await
    .expect("the run");

    let events = events.lock().expect("the events").clone();

    assert_eq!(
        kinds(&events),
        vec!["toolCall", "toolResult", "text", "done"],
        "the events of the run: {events:?}"
    );

    assert_eq!(events[0]["name"], "read_section");
    assert_eq!(events[0]["arguments"]["path"], "a.md");
    assert_eq!(events[1]["name"], "read_section");
    assert_eq!(events[1]["ok"], true);
    assert_eq!(events[1]["result"]["text"], "The title of the document.");
    assert_eq!(events[2]["text"], "The title is The title.");

    // The service was asked for the tools and then for the tool to be run.
    let tools = server.bodies_of("/v1/ai/tools");
    assert_eq!(tools.len(), 1, "the tools are asked for once");

    let sessions = server.bodies_of("/v1/ai/session");
    assert_eq!(sessions.len(), 1, "the tool is run once");
    assert!(sessions[0].contains("\"name\":\"read_section\""));
    assert!(sessions[0].contains("\"path\":\"a.md\""));

    // The tools are offered to the model, and what the tool found is told
    // back to it.
    let turns = server.bodies_of("/chat/completions");
    assert_eq!(turns.len(), 2, "the model is asked twice");
    assert!(turns[0].contains("read_section"), "the tools are offered");
    assert!(
        turns[1].contains("The title of the document."),
        "the answer of the tool is sent back: {turns:?}"
    );
}

#[tokio::test]
async fn a_run_without_a_provider_says_so_and_stops() {
    let server = MockServer::start(vec![], TOOLS, SESSION);

    let directory = TempDir::new().expect("a temporary folder");
    let config = AppConfig {
        providers: Vec::new(),
        active_provider_id: None,
        active_model: None,
        ai_enabled: true,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    let mut request = request(&server.base_url);
    request.provider_id = None;

    run_in(directory.path(), request, channel, CancelFlag::default())
        .await
        .expect("the run");

    let events = events.lock().expect("the events").clone();

    assert_eq!(kinds(&events), vec!["error", "done"]);
    assert!(
        events[0]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("No provider is set up"),
        "the message: {events:?}"
    );
}

#[tokio::test]
async fn a_provider_that_fails_is_reported_to_the_webview() {
    let server = MockServer::start(vec![], TOOLS, SESSION);

    let directory = TempDir::new().expect("a temporary folder");

    // The provider is pointed at a port nothing is listening on.
    let config = AppConfig {
        providers: vec![provider("http://127.0.0.1:1")],
        active_provider_id: Some("mock".to_string()),
        active_model: Some("mock-model".to_string()),
        ai_enabled: true,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    run_in(
        directory.path(),
        request(&server.base_url),
        channel,
        CancelFlag::default(),
    )
    .await
    .expect("the run");

    let events = events.lock().expect("the events").clone();

    assert_eq!(kinds(&events), vec!["error", "done"]);
    assert!(
        events[0]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Could not reach the provider"),
        "the message: {events:?}"
    );
}

#[tokio::test]
async fn a_model_that_keeps_asking_for_tools_is_stopped() {
    let turn = asking_for_a_tool();
    let server = MockServer::start_always_calling(&turn, TOOLS, SESSION);

    let directory = settings(&server);
    let (channel, events) = event_channel();

    run_in(
        directory.path(),
        request(&server.base_url),
        channel,
        CancelFlag::default(),
    )
    .await
    .expect("the run");

    let events = events.lock().expect("the events").clone();

    // The model was asked as many times as the run allows, and not once
    // more, because a model that keeps asking for tools would otherwise
    // run forever.
    let turns = server.bodies_of("/chat/completions");
    assert_eq!(
        turns.len(),
        MAX_TOOL_ROUNDS,
        "the model was asked {len} times",
        len = turns.len()
    );

    let messages = events
        .iter()
        .filter(|event| event["type"] == "error")
        .filter_map(|event| event["message"].as_str())
        .collect::<Vec<_>>();

    assert!(
        messages
            .iter()
            .any(|message| message.contains("asked for more tools than one run allows")),
        "the messages: {messages:?}"
    );

    assert_eq!(
        events.last().map(|event| event["type"].as_str().unwrap_or_default()),
        Some("done"),
        "the run ends: {events:?}"
    );
}

#[tokio::test]
async fn a_run_that_is_stopped_does_not_ask_the_model_again() {
    let turn = asking_for_a_tool();
    let server = MockServer::start_slowly(
        vec![turn.as_str()],
        Duration::from_millis(300),
        TOOLS,
        SESSION,
    );

    let directory = settings(&server);
    let (channel, events) = event_channel();

    let cancel = CancelFlag::default();
    let stopper = cancel.clone();

    // The run and the stopping of it go on together, because the run has to
    // be stopped while the model is still thinking.
    let (run, _) = tokio::join!(
        run_in(
            directory.path(),
            request(&server.base_url),
            channel,
            cancel.clone()
        ),
        async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            stopper.cancel();
        }
    );

    run.expect("the run");

    let events = events.lock().expect("the events").clone();

    // The run asked the model once and stopped, rather than going on for
    // every round the run allows.
    let turns = server.bodies_of("/chat/completions");
    assert_eq!(
        turns.len(),
        1,
        "the model was asked {len} times",
        len = turns.len()
    );

    assert_eq!(
        events.last().map(|event| event["type"].as_str().unwrap_or_default()),
        Some("done"),
        "the run ends: {events:?}"
    );
}

#[tokio::test]
async fn a_run_with_the_assistant_turned_off_sends_nothing() {
    let server = MockServer::start(vec![], TOOLS, SESSION);

    let directory = TempDir::new().expect("a temporary folder");

    let config = AppConfig {
        providers: vec![provider(&server.base_url)],
        active_provider_id: Some("mock".to_string()),
        active_model: Some("mock-model".to_string()),
        ai_enabled: false,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    run_in(
        directory.path(),
        request(&server.base_url),
        channel,
        CancelFlag::default(),
    )
    .await
    .expect("the run");

    let events = events.lock().expect("the events").clone();

    assert_eq!(kinds(&events), vec!["error", "done"]);
    assert!(
        events[0]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("turned off in the settings"),
        "the message: {events:?}"
    );

    // The document never left the machine, because nothing was asked of the
    // model and nothing was asked of the service.
    assert!(
        server.bodies_of("/chat/completions").is_empty(),
        "the model was asked"
    );
    assert!(
        server.bodies_of("/v1/ai/tools").is_empty(),
        "the service was asked"
    );
}

#[tokio::test]
async fn a_provider_without_a_model_says_so() {
    let server = MockServer::start(vec![], TOOLS, SESSION);

    let directory = TempDir::new().expect("a temporary folder");

    let mut without_a_model = provider(&server.base_url);
    without_a_model.model = String::new();

    let config = AppConfig {
        providers: vec![without_a_model],
        active_provider_id: Some("mock".to_string()),
        active_model: None,
        ai_enabled: true,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    let mut request = request(&server.base_url);
    request.model = None;

    run_in(directory.path(), request, channel, CancelFlag::default())
        .await
        .expect("the run");

    let events = events.lock().expect("the events").clone();

    assert_eq!(kinds(&events), vec!["error", "done"]);
    assert!(
        events[0]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("has no model chosen"),
        "the message: {events:?}"
    );

    assert!(server.bodies_of("/chat/completions").is_empty());
}
