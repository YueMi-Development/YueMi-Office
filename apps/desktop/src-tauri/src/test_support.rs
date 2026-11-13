//! A server that stands in for the model provider and the render service.
//!
//! The tests use it to have the other end of a conversation without a
//! provider account and without the service running: the requests are
//! recorded, so a test can see what was sent, and the answers are given, so
//! a test can see what comes back.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

/// A server that plays both the model provider and the render service.
///
/// The two roles are told apart by the path of the request, which is how
/// the real thing works as well.
pub struct MockServer {
    /// The address the server is on.
    pub base_url: String,
    /// The requests the server received, with the path of each.
    requests: Arc<Mutex<Vec<(String, String)>>>,
    /// The heads of the requests, which carry the headers.
    heads: Arc<Mutex<Vec<String>>>,
}

impl MockServer {
    /// Starts a server.
    ///
    /// The provider answers with the given turns, one per request, and the
    /// service answers with the given tools and the given session.
    pub fn start(turns: Vec<&str>, tools: &'static str, session: &'static str) -> Self {
        let turns = turns.iter().map(|turn| turn.to_string()).collect();
        Self::serve(turns, false, tools, session)
    }

    /// Starts a server that answers with the same turn every time.
    ///
    /// The run loop goes on asking for tools as long as the model asks for
    /// them, so a test that needs the loop to keep going needs a server that
    /// never stops answering with a call.
    pub fn start_always_calling(turn: &str, tools: &'static str, session: &'static str) -> Self {
        Self::serve(vec![turn.to_string()], true, tools, session)
    }

    /// Starts a server that takes its time before it answers.
    ///
    /// A run that is stopped while the model is still thinking needs the
    /// answer to be slow, otherwise the run is over before the test can stop
    /// it.
    pub fn start_slowly(
        turns: Vec<&str>,
        delay: std::time::Duration,
        tools: &'static str,
        session: &'static str,
    ) -> Self {
        let turns = turns.iter().map(|turn| turn.to_string()).collect();
        Self::serve_with_delay(turns, false, tools, session, Some(delay))
    }

    /// Starts the server that answers the requests.
    fn serve(turns: Vec<String>, repeat: bool, tools: &'static str, session: &'static str) -> Self {
        Self::serve_with_delay(turns, repeat, tools, session, None)
    }

    /// Starts the server that answers the requests, taking its time.
    fn serve_with_delay(
        turns: Vec<String>,
        repeat: bool,
        tools: &'static str,
        session: &'static str,
        delay: Option<std::time::Duration>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port to bind");
        let port = listener.local_addr().expect("the address").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let heads = Arc::new(Mutex::new(Vec::new()));

        let recorded = Arc::clone(&requests);
        let recorded_heads = Arc::clone(&heads);
        let tools = tools.to_string();
        let session = session.to_string();

        thread::spawn(move || {
            let mut turn_index = 0usize;

            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let path = read_request(&mut stream, &recorded, &recorded_heads);

                if let Some(delay) = delay {
                    // The wait is only for the provider, because the test is
                    // about a run that is stopped while the model is still
                    // thinking.
                    if path.starts_with("/chat/completions") {
                        thread::sleep(delay);
                    }
                }

                let response = if path.starts_with("/chat/completions") {
                    let turn = if repeat {
                        turns.first().cloned().unwrap_or_default()
                    } else {
                        let turn = turns
                            .get(turn_index)
                            .cloned()
                            .unwrap_or_else(|| "data: [DONE]\n\n".to_string());
                        turn_index += 1;
                        turn
                    };
                    sse(&turn)
                } else if path.ends_with("/v1/ai/tools") {
                    json_response(200, &tools)
                } else if path.ends_with("/v1/ai/session") {
                    json_response(200, &session)
                } else {
                    json_response(404, "{}")
                };

                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            requests,
            heads,
        }
    }

    /// The requests the server received, with the path of each.
    pub fn requests(&self) -> Vec<(String, String)> {
        self.requests.lock().expect("the requests").clone()
    }

    /// The heads of the requests, which carry the headers.
    pub fn heads(&self) -> Vec<String> {
        self.heads.lock().expect("the heads").clone()
    }

    /// The bodies of the requests that went to a path.
    pub fn bodies_of(&self, path: &str) -> Vec<String> {
        self.requests()
            .into_iter()
            .filter(|(seen, _)| seen.contains(path))
            .map(|(_, body)| body)
            .collect()
    }
}

/// Reads a request off the connection and records it.
///
/// The head is recorded as well as the body, because the head carries the
/// headers, and a test that wants to see which key was sent looks there.
fn read_request(
    stream: &mut std::net::TcpStream,
    recorded: &Arc<Mutex<Vec<(String, String)>>>,
    heads: &Arc<Mutex<Vec<String>>>,
) -> String {
    let mut reader = BufReader::new(stream.try_clone().expect("a copy"));

    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line);

    let mut head = request_line.clone();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).expect("a line") == 0 {
            break;
        }
        if line == "\r\n" {
            break;
        }

        head.push_str(&line);

        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }

    let mut bytes = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut bytes).expect("the body");
    }

    let body = String::from_utf8_lossy(&bytes).to_string();
    recorded
        .lock()
        .expect("the requests")
        .push((request_line.clone(), body));
    heads.lock().expect("the heads").push(head);

    request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_string()
}

/// A response that carries a stream of events.
fn sse(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
}

/// A response that carries JSON.
fn json_response(status: u16, body: &str) -> String {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
}

/// The turn of a provider that asks for one tool.
///
/// The frame is built rather than written out, because the arguments of the
/// call have to be escaped inside the JSON, and that is easier to get right
/// when the escaping is done by the library.
pub fn asking_for_a_tool() -> String {
    let frame = serde_json::json!({
        "choices": [{
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "read_section",
                        "arguments": serde_json::json!({ "path": "a.md" }).to_string()
                    }
                }]
            }
        }]
    });

    format!("data: {frame}\n\n")
}

/// The tools the mock service offers.
pub const TOOLS: &str = r#"[
  {
    "name": "read_section",
    "description": "Read a section of a file.",
    "parameters": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    }
  }
]"#;

/// The tools the mock service offers when a test needs one that changes the
/// document as well as one that reads it.
///
/// The chat mode only offers the tools that read, so a test of that mode
/// needs a service that offers more than that.
pub const TOOLS_WITH_A_CHANGE: &str = r#"[
  {
    "name": "read_section",
    "description": "Read a section of a file.",
    "parameters": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    }
  },
  {
    "name": "propose_edit",
    "description": "Propose a change to a file.",
    "parameters": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    }
  }
]"#;

/// The answer the mock service gives when a tool is run.
pub const SESSION: &str = r#"{
  "id": "session-1",
  "calls": [
    {
      "id": "call_1",
      "name": "read_section",
      "arguments": { "path": "a.md" },
      "ok": true,
      "result": { "text": "The title of the document." }
    }
  ],
  "edits": []
}"#;
