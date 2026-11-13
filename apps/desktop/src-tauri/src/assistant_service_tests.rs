//! The assistant run against the real render service.
//!
//! The other tests in this folder use a stand-in for the service, so they
//! run anywhere. This one talks to the service that is actually there, so
//! the tools the assistant is offered and the answers the tools give are the
//! real ones.
//!
//! The service has to be running for the test to do anything. When it is
//! not, the test says so and passes, because a test that fails for a reason
//! that is not about the code is worse than no test.
//!
//! Start it with:
//!
//! ```text
//! cd apps/api && .venv/Scripts/python.exe -m uvicorn app.main:app --port 32100
//! ```

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::config::{AppConfig, ProviderConfig, ProviderProtocol};
use crate::test_support::MockServer;
use crate::testing::{run_in, write_config_to, CancelFlag, ChatMessage, ChatRequest};

use tempfile::TempDir;

/// Where the render service listens.
const SERVICE_URL: &str = "http://127.0.0.1:32100";

/// Whether the service is answering.
async fn service_is_there() -> bool {
    match crate::providers::client() {
        Ok(client) => client
            .get(format!("{SERVICE_URL}/v1/ai/tools"))
            .send()
            .await
            .is_ok(),
        Err(_) => false,
    }
}

/// A provider that asks a mock server for a tool and then for an answer.
///
/// The service under test is the real one; only the model is a stand-in,
/// because a real model would need a key.
fn mock_provider(base_url: &str) -> ProviderConfig {
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

#[tokio::test]
async fn the_service_offers_the_tools_the_assistant_may_call() {
    if !service_is_there().await {
        eprintln!("the render service is not running, so this is skipped");
        return;
    }

    let tools: Vec<Value> = crate::providers::client()
        .expect("a client")
        .get(format!("{SERVICE_URL}/v1/ai/tools"))
        .send()
        .await
        .expect("the tools")
        .json()
        .await
        .expect("the tools as JSON");

    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();

    assert!(names.contains(&"read_section"), "the tools: {names:?}");
    assert!(names.contains(&"propose_edit"), "the tools: {names:?}");
    assert!(names.contains(&"set_style"), "the tools: {names:?}");
    assert!(names.contains(&"render_preview"), "the tools: {names:?}");

    // Every tool says what its arguments are, or the model cannot call it.
    for tool in &tools {
        assert!(
            tool["parameters"].is_object(),
            "the tool has no arguments: {tool}"
        );
    }
}

#[tokio::test]
async fn the_service_runs_a_tool_against_a_project() {
    if !service_is_there().await {
        eprintln!("the render service is not running, so this is skipped");
        return;
    }

    let body = json!({
        "project": {
            "root": "test",
            "title": "A document",
            "content": ["content/a.md"]
        },
        "files": [
            { "path": "content/a.md", "text": "# The title\n\nSome text.\n" }
        ],
        "assets": [],
        "fonts": [],
        "calls": [
            {
                "id": "call_1",
                "name": "list_sections",
                "arguments": {}
            }
        ]
    });

    let session: Value = crate::providers::client()
        .expect("a client")
        .post(format!("{SERVICE_URL}/v1/ai/session"))
        .json(&body)
        .send()
        .await
        .expect("the session")
        .json()
        .await
        .expect("the session as JSON");

    let calls = session["calls"].as_array().expect("the calls");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["ok"], true, "the call failed: {calls:?}");
    assert_eq!(calls[0]["name"], "list_sections");

    // The tool found the heading of the document.
    let text = calls[0]["result"].to_string();
    assert!(text.contains("The title"), "the result: {text}");
}

#[tokio::test]
async fn a_change_to_a_stylesheet_shows_the_rendered_pages() {
    if !service_is_there().await {
        eprintln!("the render service is not running, so this is skipped");
        return;
    }

    let server = MockServer::start(
        vec![
            // The model asks for a change to the stylesheet, which is a
            // change that affects the layout.
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\
             \"function\":{\"name\":\"propose_edit\",\"arguments\":\
             \"{\\\"path\\\":\\\"style.css\\\",\\\"newText\\\":\\\"body { font-size: 14pt; }\\\"}\"}}]}}]}\n\n\
\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"The text is bigger now.\"}}]}\n\n\
             data: [DONE]\n\n",
        ],
        "[]",
        "{}",
    );

    let directory = TempDir::new().expect("a temporary folder");
    let config = AppConfig {
        providers: vec![mock_provider(&server.base_url)],
        active_provider_id: Some("mock".to_string()),
        active_model: Some("mock-model".to_string()),
        ai_enabled: true,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    let request = ChatRequest {
        messages: vec![ChatMessage::text("user", "Make the text bigger.")],
        project: json!({
            "title": "A document",
            "content": ["content/a.md"],
            "styles": ["style.css"]
        }),
        files: vec![
            json!({ "path": "content/a.md", "text": "# The title\n\nSome text.\n" }),
            json!({ "path": "style.css", "text": "body { font-size: 12pt; }" }),
        ],
        assets: Vec::new(),
        fonts: Vec::new(),
        service_url: SERVICE_URL.to_string(),
        provider_id: Some("mock".to_string()),
        model: Some("mock-model".to_string()),
    };

    run_in(directory.path(), request, channel, CancelFlag::default())
        .await
        .expect("the run");

    let events = events.lock().expect("the events").clone();
    let kinds: Vec<&str> = events
        .iter()
        .map(|event| event["type"].as_str().unwrap_or_default())
        .collect();

    assert_eq!(
        kinds,
        vec!["toolCall", "toolResult", "edit", "pages", "text", "done"],
        "the events of the run: {events:?}"
    );

    // The change was proposed, with the difference the user sees.
    let edit = &events[2]["edit"];
    assert_eq!(edit["path"], "style.css");
    assert_eq!(edit["kind"], "replace");

    // The document was rendered again and the pages were counted.
    assert_eq!(events[3]["pageCount"], 1, "the pages: {events:?}");

    // The model cannot see the images, so it is told how many pages there
    // are instead.
    let turns = server.bodies_of("/chat/completions");
    assert!(
        turns[1].contains("rendered to 1 pages"),
        "the model is told about the pages: {turns:?}"
    );
}

#[tokio::test]
async fn the_agent_loop_runs_a_real_tool_against_the_real_service() {
    if !service_is_there().await {
        eprintln!("the render service is not running, so this is skipped");
        return;
    }

    let server = MockServer::start(
        vec![
            // The model asks for a real tool.
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\
             \"function\":{\"name\":\"list_sections\",\"arguments\":\"{}\"}}]}}]}\n\n\
\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"The document has one section.\"}}]}\n\n\
             data: [DONE]\n\n",
        ],
        // The tools of the mock are replaced by the real ones, because it is
        // the real service that answers here.
        "[]",
        "{}",
    );

    let directory = TempDir::new().expect("a temporary folder");
    let config = AppConfig {
        providers: vec![mock_provider(&server.base_url)],
        active_provider_id: Some("mock".to_string()),
        active_model: Some("mock-model".to_string()),
        ai_enabled: true,
    };
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let (channel, events) = event_channel();

    let request = ChatRequest {
        messages: vec![ChatMessage::text("user", "What are the sections?")],
        project: json!({
            "title": "A document",
            "content": ["content/a.md"]
        }),
        files: vec![json!({ "path": "content/a.md", "text": "# The title\n\nSome text.\n" })],
        assets: Vec::new(),
        fonts: Vec::new(),
        service_url: SERVICE_URL.to_string(),
        provider_id: Some("mock".to_string()),
        model: Some("mock-model".to_string()),
    };

    run_in(directory.path(), request, channel, CancelFlag::default())
        .await
        .expect("the run");

    let events = events.lock().expect("the events").clone();
    let kinds: Vec<&str> = events
        .iter()
        .map(|event| event["type"].as_str().unwrap_or_default())
        .collect();

    assert_eq!(
        kinds,
        vec!["toolCall", "toolResult", "text", "done"],
        "the events of the run: {events:?}"
    );

    assert_eq!(events[0]["name"], "list_sections");
    assert_eq!(events[1]["ok"], true, "the tool failed: {events:?}");

    // The answer the real tool gave came back to the model.
    let answer = events[1]["result"].to_string();
    assert!(answer.contains("The title"), "the result: {answer}");

    let turns = server.bodies_of("/chat/completions");
    assert_eq!(turns.len(), 2);
    assert!(
        turns[1].contains("The title"),
        "the answer of the tool is sent back: {turns:?}"
    );
}
