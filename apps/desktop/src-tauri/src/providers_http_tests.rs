//! Tests that talk to a server over HTTP.
//!
//! The other provider tests read the frames directly. These ones put a
//! server on the other end, so the whole path is exercised: the request is
//! built, it is sent, the answer is read as it arrives, and the tool call
//! comes out the other side. A mistake in the request or in how the stream
//! is read shows up here rather than in a run against a live provider.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use serde_json::json;

use crate::config::{ProviderConfig, ProviderProtocol};
use crate::providers::{
    anthropic, openai, ChatMessage, ProviderEndpoint, ProviderEvent, ProviderRequest, ProviderTurn,
};

/// A server that answers one request with the given body.
struct MockServer {
    /// The address the server is on.
    base_url: String,
    /// The request the server received, as it was read.
    request: std::sync::mpsc::Receiver<String>,
}

impl MockServer {
    /// Starts a server that answers with the given frames.
    fn start(frames: &str) -> Self {
        Self::start_with(format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
            frames.len(),
            frames
        ))
    }

    /// Starts a server that answers with the given raw response.
    fn start_with(response: String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port to bind");
        let port = listener.local_addr().expect("the address").port();
        let (sender, request) = std::sync::mpsc::channel();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a connection");

            let mut reader = BufReader::new(stream.try_clone().expect("a copy"));
            let mut body = String::new();
            let mut content_length = 0usize;

            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).expect("a line") == 0 {
                    break;
                }

                if line == "\r\n" {
                    break;
                }

                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().unwrap_or(0);
                }
            }

            let mut bytes = vec![0u8; content_length];
            if content_length > 0 {
                reader.read_exact(&mut bytes).expect("the body");
            }
            body.push_str(&String::from_utf8_lossy(&bytes));

            let _ = sender.send(body);

            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            request,
        }
    }

    /// The request the server received.
    fn request(&self) -> String {
        self.request
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("the request")
    }
}

/// A server that keeps the connection open and counts the connections.
///
/// The other server here closes the connection after the answer, which is
/// enough for reading a stream. A client that keeps connections open
/// between requests needs a server that does the same, so the connection
/// can be handed back to it.
struct KeepAliveServer {
    /// The address the server is on.
    base_url: String,
    /// How many connections were opened.
    connections: Arc<AtomicUsize>,
}

impl KeepAliveServer {
    /// Starts a server that answers every request the same way.
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port to bind");
        let port = listener.local_addr().expect("the address").port();
        let connections = Arc::new(AtomicUsize::new(0));

        let counted = Arc::clone(&connections);

        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                counted.fetch_add(1, Ordering::SeqCst);

                thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().expect("a copy"));

                    // The connection stays open, so a client that keeps
                    // connections may send another request on it.
                    loop {
                        let mut content_length = 0usize;

                        loop {
                            let mut line = String::new();
                            if reader.read_line(&mut line).expect("a line") == 0 {
                                return;
                            }
                            if line == "\r\n" {
                                break;
                            }
                            if let Some(value) =
                                line.to_ascii_lowercase().strip_prefix("content-length:")
                            {
                                content_length = value.trim().parse().unwrap_or(0);
                            }
                        }

                        let mut bytes = vec![0u8; content_length];
                        if content_length > 0 && reader.read_exact(&mut bytes).is_err() {
                            return;
                        }

                        let body = "data: [DONE]\n\n".to_string();
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
                            body.len(),
                            body
                        );

                        if stream.write_all(response.as_bytes()).is_err() {
                            return;
                        }
                        let _ = stream.flush();
                    }
                });
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            connections,
        }
    }

    /// How many connections were opened.
    fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }
}

/// A provider that speaks OpenAI's format.
fn openai_provider() -> ProviderConfig {
    ProviderConfig {
        id: "mock".to_string(),
        name: "Mock".to_string(),
        protocol: ProviderProtocol::Openai,
        base_url: String::new(),
        model: "mock-model".to_string(),
        models: Vec::new(),
        supports_images: false,
        requires_key: false,
    }
}

/// A request with one message in it.
fn request() -> ProviderRequest {
    ProviderRequest {
        system: "Be brief.".to_string(),
        messages: vec![ChatMessage::text("user", "Say hello.")],
        tools: Vec::new(),
        model: "mock-model".to_string(),
    }
}

/// The frames of an OpenAI answer that says "Hello there".
fn openai_answer() -> String {
    let mut frames = String::new();
    frames.push_str(&sse(&json!({"choices": [{"delta": {"content": "Hello"}}]})));
    frames.push_str(&sse(&json!({"choices": [{"delta": {"content": " there"}}]})));
    frames.push_str(&sse_done());
    frames
}

#[tokio::test]
async fn the_openai_client_reads_the_answer_over_http() {
    let server = MockServer::start(&openai_answer());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: None,
    };

    let mut text = String::new();
    let mut on_event = |event: ProviderEvent| {
        if let ProviderEvent::Text(piece) = event {
            text.push_str(&piece);
        }
    };

    let turn: ProviderTurn = openai::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    assert_eq!(text, "Hello there");
    assert_eq!(turn.text, "Hello there");
}

/// The frames of an OpenAI answer that asks for one tool.
fn openai_tool_call() -> String {
    let mut frames = String::new();

    frames.push_str(&sse(&json!({
        "choices": [{
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "read_section",
                        "arguments": "{\"path\":\"a.md\"}"
                    }
                }]
            }
        }]
    })));

    frames.push_str(&sse_done());
    frames
}

/// The frames of an Anthropic answer that says "Hello".
fn anthropic_answer() -> String {
    let mut frames = String::new();
    frames.push_str(&anthropic_event(
        "content_block_delta",
        &json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "Hello"}
        }),
    ));
    frames.push_str(&anthropic_event("message_stop", &json!({"type": "message_stop"})));
    frames
}

/// The frames of an Anthropic answer that asks for one tool.
fn anthropic_tool_call() -> String {
    let mut frames = String::new();
    frames.push_str(&anthropic_event(
        "content_block_start",
        &json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "tool_use", "id": "call_1", "name": "read_section"}
        }),
    ));
    frames.push_str(&anthropic_event(
        "content_block_delta",
        &json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": {
                "type": "input_json_delta",
                "partial_json": "{\"path\":\"a.md\"}"
            }
        }),
    ));
    frames.push_str(&anthropic_event("message_stop", &json!({"type": "message_stop"})));
    frames
}

/// One frame of a stream.
fn sse(value: &serde_json::Value) -> String {
    let mut frame = String::from("data: ");
    frame.push_str(&value.to_string());
    frame.push_str("\n\n");
    frame
}

/// The frame that ends an OpenAI stream.
///
/// It is not JSON: the API sends the word on its own, and the reader knows
/// it by that.
fn sse_done() -> String {
    String::from("data: [DONE]\n\n")
}

/// One frame of an Anthropic stream, which names its event.
fn anthropic_event(name: &str, value: &serde_json::Value) -> String {
    let mut frame = String::from("event: ");
    frame.push_str(name);
    frame.push_str("\ndata: ");
    frame.push_str(&value.to_string());
    frame.push_str("\n\n");
    frame
}

#[tokio::test]
async fn the_openai_client_sends_the_request_it_was_given() {
    let server = MockServer::start(&openai_answer());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: Some("secret-key".to_string()),
    };

    let mut on_event = |_event: ProviderEvent| {};

    openai::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    let body = server.request();
    assert!(body.contains("\"model\":\"mock-model\""));
    assert!(body.contains("\"content\":\"Say hello.\""));
    assert!(body.contains("\"stream\":true"));
}

#[tokio::test]
async fn the_openai_client_reads_a_tool_call_over_http() {
    let server = MockServer::start(&openai_tool_call());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: None,
    };

    let mut on_event = |_event: ProviderEvent| {};

    let turn = openai::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    assert_eq!(turn.tool_calls.len(), 1);
    assert_eq!(turn.tool_calls[0].name, "read_section");
    assert_eq!(turn.tool_calls[0].arguments["path"], "a.md");
}

#[tokio::test]
async fn the_anthropic_client_reads_the_answer_over_http() {
    let server = MockServer::start(&anthropic_answer());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: None,
    };

    let mut text = String::new();
    let mut on_event = |event: ProviderEvent| {
        if let ProviderEvent::Text(piece) = event {
            text.push_str(&piece);
        }
    };

    let turn = anthropic::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    assert_eq!(text, "Hello");
    assert_eq!(turn.text, "Hello");
}

#[tokio::test]
async fn the_anthropic_client_reads_a_tool_call_over_http() {
    let server = MockServer::start(&anthropic_tool_call());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: None,
    };

    let mut on_event = |_event: ProviderEvent| {};

    let turn = anthropic::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    assert_eq!(turn.tool_calls.len(), 1);
    assert_eq!(turn.tool_calls[0].name, "read_section");
    assert_eq!(turn.tool_calls[0].arguments["path"], "a.md");
}

#[tokio::test]
async fn a_refused_key_is_reported_as_such() {
    let body = r#"{"error":{"message":"Invalid API key"}}"#;
    let server = MockServer::start_with(format!(
        "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    ));

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: Some("wrong".to_string()),
    };

    let mut on_event = |_event: ProviderEvent| {};

    let error = openai::stream_turn(&endpoint, &request(), &mut on_event)
        .await
        .expect_err("the call should fail");

    assert_eq!(error.status, Some(401));
    assert!(error.message.contains("Invalid API key"));
}

#[tokio::test]
async fn the_client_can_be_told_which_provider_to_use() {
    // The two formats are told apart by the provider's own setting, not by
    // the address, so a compatible server works the same way as OpenAI's.
    let server = MockServer::start(&openai_answer());

    let endpoint = ProviderEndpoint {
        base_url: server.base_url.clone(),
        api_key: None,
    };

    let mut provider = openai_provider();
    provider.protocol = ProviderProtocol::OpenaiCompatible;

    let mut text = String::new();
    let mut on_event = |event: ProviderEvent| {
        if let ProviderEvent::Text(piece) = event {
            text.push_str(&piece);
        }
    };

    crate::providers::stream_turn(&provider, &endpoint, &request(), &mut on_event)
        .await
        .expect("the answer");

    assert_eq!(text, "Hello there");
}

/// Sends one request with the shared client and reads the whole answer.
async fn ask(url: &str, body: &serde_json::Value) {
    let response = crate::providers::client()
        .expect("a client")
        .post(url)
        .json(body)
        .send()
        .await
        .expect("the answer");

    // The body is read to the end, so the connection goes back to the pool
    // of the client.
    let _ = response.bytes().await.expect("the body");
}

#[tokio::test]
async fn the_client_does_not_keep_a_connection_between_requests() {
    // The client is kept between calls, so a connection it holds on to
    // would be handed back to the next call. That connection belongs to the
    // runtime that opened it, and a run may happen on a runtime of its own
    // — a test has a runtime of its own for every test — so a kept
    // connection would be dead by the time it was used again.
    let server = KeepAliveServer::start();

    let url = format!("{}/chat/completions", server.base_url);
    let body = json!({ "model": "mock-model", "messages": [] });

    ask(&url, &body).await;
    ask(&url, &body).await;

    // Each request opened a connection of its own, because a connection
    // kept from the first one would have been handed back to the second.
    assert_eq!(
        server.connections(),
        2,
        "the connection of the first request was kept"
    );
}

#[test]
fn a_request_on_another_runtime_still_succeeds() {
    // The two requests go to the same address, because that is what makes
    // the client reach for the connection it already has. The runtimes
    // are of their own, and the first is gone by the time the second
    // request is made.
    let server = KeepAliveServer::start();

    let url = format!("{}/chat/completions", server.base_url);
    let body = json!({ "model": "mock-model", "messages": [] });

    // A runtime of its own, which is gone by the time the next request is
    // made.
    {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("a runtime");

        runtime.block_on(ask(&url, &body));
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("a runtime");

    // The request has to go through. A connection kept from the first
    // runtime belongs to that runtime, which is gone, so handing it back
    // here would fail with "the runtime dropped the dispatch task" — the
    // failure that showed up when several tests ran one after another.
    runtime.block_on(ask(&url, &body));

    assert!(
        server.connections() >= 2,
        "the connection of the first runtime was kept"
    );
}

#[test]
fn the_body_of_a_request_carries_the_tools() {
    let mut provider_request = request();
    provider_request.tools = vec![crate::providers::ToolDefinition {
        name: "read_section".to_string(),
        description: "Read a section.".to_string(),
        parameters: json!({ "type": "object" }),
    }];

    let body = openai::build_body(&provider_request);
    let tools = body["tools"].as_array().expect("the tools");

    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["type"], "function");
    assert_eq!(tools[0]["function"]["name"], "read_section");
}
