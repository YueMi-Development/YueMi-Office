//! Talking to the model providers.
//!
//! The two wire formats in use are Anthropic's Messages API and OpenAI's
//! Chat Completions API. Any server that speaks the second one — Ollama,
//! LM Studio, OpenRouter, vLLM — works the same way, because only the
//! address differs.
//!
//! Both are turned into the same events, so the agent loop does not have to
//! know which provider it is talking to.

pub mod anthropic;
pub mod openai;
pub mod sse;

use std::error::Error;

use serde::{Deserialize, Serialize};

use crate::config::{ProviderConfig, ProviderProtocol};

/// What a part of a message holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ContentPart {
    /// Text the user or the model wrote.
    Text {
        /// The text.
        text: String,
    },
    /// A rendered page, as a PNG.
    Image {
        /// The image's bytes, base64-encoded.
        base64: String,
        /// The MIME type, which is always `image/png` for now.
        mime_type: String,
    },
}

/// A message in the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Who said it: `user`, `assistant` or `tool`.
    pub role: String,
    /// What was said.
    #[serde(default)]
    pub content: Vec<ContentPart>,
    /// The tools the assistant asked for, when it asked for any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// The answer to one tool call, when this message is the answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// The name of the tool, when this message is the answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

impl ChatMessage {
    /// A message of plain text.
    pub fn text(role: &str, text: impl Into<String>) -> Self {
        Self {
            role: role.to_string(),
            content: vec![ContentPart::Text { text: text.into() }],
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
        }
    }
}

/// A tool the assistant asked for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// The provider's identifier for the call.
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The arguments, as the provider sends them.
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// A tool the assistant may call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    /// The tool's name.
    pub name: String,
    /// What the tool does.
    pub description: String,
    /// The JSON schema of the arguments.
    #[serde(default)]
    pub parameters: serde_json::Value,
}

/// Everything sent to a provider for one turn.
#[derive(Debug, Clone)]
pub struct ProviderRequest {
    /// The instructions that stay the same for the whole conversation.
    pub system: String,
    /// The conversation so far.
    pub messages: Vec<ChatMessage>,
    /// The tools the assistant may call.
    pub tools: Vec<ToolDefinition>,
    /// The model to use.
    pub model: String,
}

/// What came back from a provider.
#[derive(Debug, Clone)]
pub enum ProviderEvent {
    /// A piece of the answer.
    Text(String),
    /// The assistant asked for a tool.
    ToolCall(ToolCall),
    /// The provider finished the turn.
    Done,
}

/// The result of a whole turn.
#[derive(Debug, Clone, Default)]
pub struct ProviderTurn {
    /// The answer, as it was streamed.
    pub text: String,
    /// The tools the assistant asked for.
    pub tool_calls: Vec<ToolCall>,
}

/// The address of the provider's API, and the key to use with it.
#[derive(Debug, Clone)]
pub struct ProviderEndpoint {
    /// Where the requests go.
    pub base_url: String,
    /// The key, when the provider needs one.
    pub api_key: Option<String>,
}

/// A tool call that is being read.
///
/// The arguments arrive as JSON text in pieces, so they are joined before
/// they are read. The two wire formats differ in how the pieces are
/// labelled, but not in what they mean, so both use this.
#[derive(Debug, Clone)]
pub struct PendingCall {
    /// The call's identifier.
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The arguments, as JSON text that arrived in pieces.
    pub arguments: String,
    /// Which content block the call belongs to.
    ///
    /// Anthropic labels every block, including the text ones, and the pieces
    /// of a call name the block they belong to. The number is kept so the
    /// pieces find the right call even when a text block came first.
    pub block_index: Option<usize>,
}

impl PendingCall {
    /// A call with nothing read yet.
    pub fn new() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            arguments: String::new(),
            block_index: None,
        }
    }

    /// Adds a piece of the arguments.
    pub fn push_arguments(&mut self, piece: &str) {
        self.arguments.push_str(piece);
    }

    /// The arguments, read as JSON.
    ///
    /// A tool that arrives with no arguments at all has none, and text that
    /// is not valid JSON is reported as an empty set of arguments rather
    /// than stopping the run.
    pub fn finish(&self) -> serde_json::Value {
        let trimmed = self.arguments.trim();
        if trimmed.is_empty() {
            return serde_json::json!({});
        }
        serde_json::from_str(trimmed).unwrap_or_else(|_| serde_json::json!({}))
    }
}

/// The endpoint a provider's configuration describes.
pub fn endpoint_for(provider: &ProviderConfig, api_key: Option<String>) -> ProviderEndpoint {
    ProviderEndpoint {
        base_url: provider.base_url.trim_end_matches('/').to_string(),
        api_key,
    }
}

/// The Anthropic version header the API expects.
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// A provider call that failed.
#[derive(Debug)]
pub struct ProviderError {
    /// What to tell the user.
    pub message: String,
    /// The HTTP status, when there was one.
    pub status: Option<u16>,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for ProviderError {}

/// The header an Anthropic request carries.
pub fn anthropic_headers(api_key: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![
        ("content-type", "application/json".to_string()),
        ("anthropic-version", ANTHROPIC_VERSION.to_string()),
    ];
    if let Some(key) = api_key {
        headers.push(("x-api-key", key.to_string()));
    }
    headers
}

/// The header an OpenAI request carries.
pub fn openai_headers(api_key: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("content-type", "application/json".to_string())];
    if let Some(key) = api_key {
        headers.push(("authorization", format!("Bearer {key}")));
    }
    headers
}

/// Sends a request to a provider and returns the streaming response.
///
/// The response's body is a stream of bytes, because the answer arrives
/// piece by piece. A failure that comes back as a status rather than as a
/// broken connection is turned into a message that says what the provider
/// said, because that is what tells the user whether the key is wrong.
pub async fn send(
    url: &str,
    headers: Vec<(&'static str, String)>,
    body: &serde_json::Value,
) -> Result<reqwest::Response, ProviderError> {
    let client = client()?;

    let mut request = client.post(url).json(body);
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let response = request.send().await.map_err(|error| ProviderError {
        message: describe_transport_failure("Could not reach the provider", &error),
        status: None,
    })?;

    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = response.text().await.unwrap_or_default();
    Err(ProviderError {
        message: describe_failure(status.as_u16(), &body),
        status: Some(status.as_u16()),
    })
}

/// The client the provider calls are made with.
///
/// It is built once and kept, because building one costs more than making a
/// request does.
///
/// It is also the client the render service is reached with, because a
/// client built without the cryptography provider in place would fail, and
/// the provider is the one that puts it there.
///
/// The client keeps no connection open between requests. A kept connection
/// belongs to the runtime that opened it, and a run may happen on a
/// different one — a test has a runtime of its own for every test — so a
/// kept connection would be dead by the time it was used again.
pub fn client() -> Result<reqwest::Client, ProviderError> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> = std::sync::OnceLock::new();

    let stored = CLIENT.get_or_init(|| {
        // The provider of the cryptography is chosen here rather than when
        // the app starts, so a call made outside the app — a test, or a
        // tool — finds one in place.
        let _ = rustls::crypto::ring::default_provider().install_default();

        reqwest::Client::builder()
            .user_agent("yuemi-office")
            .pool_max_idle_per_host(0)
            .build()
            .map_err(|error| error.to_string())
    });

    match stored {
        Ok(client) => Ok(client.clone()),
        Err(error) => Err(ProviderError {
            message: format!("Could not prepare the connection: {error}"),
            status: None,
        }),
    }
}

/// Turns a failed request into a message worth showing.
///
/// The reason is in the cause of the failure, not in the failure itself:
/// "error sending request" says nothing about whether the address was
/// wrong, the server was down or the connection was refused.
pub fn describe_transport_failure(context: &str, error: &reqwest::Error) -> String {
    let mut reason = error.to_string();

    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !reason.contains(&text) {
            reason = format!("{reason}: {text}");
        }
        source = cause.source();
    }

    format!("{context}: {reason}")
}

/// Turns a failed response into a message worth showing.
///
/// The status says what kind of failure it was, and the body says what the
/// provider said about it. The body is read in the shapes the providers use,
/// and anything unreadable is shown as it came, because a message the user
/// cannot read is still better than none.
pub fn describe_failure(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .map(|message| message.to_string())
        })
        .or_else(|| {
            serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|value| {
                    value
                        .get("message")
                        .and_then(|message| message.as_str())
                        .map(|message| message.to_string())
                })
        })
        .unwrap_or_else(|| body.trim().to_string());

    match status {
        401 => format!("The provider refused the key. {detail}"),
        403 => format!("The provider refused the request. {detail}"),
        404 => format!("The provider has no such endpoint or model. {detail}"),
        429 => format!("The provider is rate limiting the request. {detail}"),
        status if status >= 500 => {
            format!("The provider had a problem of its own ({status}). {detail}")
        }
        _ => format!("The provider refused the request ({status}). {detail}"),
    }
}

/// Sends a request to a provider and streams the answer back.
///
/// The two formats differ in more than their fields, so each has its own
/// function; both return the same events.
pub async fn stream_turn(
    provider: &ProviderConfig,
    endpoint: &ProviderEndpoint,
    request: &ProviderRequest,
    on_event: &mut (dyn FnMut(ProviderEvent) + Send),
) -> Result<ProviderTurn, ProviderError> {
    match provider.protocol {
        ProviderProtocol::Anthropic => {
            anthropic::stream_turn(endpoint, request, on_event).await
        }
        ProviderProtocol::Openai | ProviderProtocol::OpenaiCompatible => {
            openai::stream_turn(endpoint, request, on_event).await
        }
    }
}

/// Turns the text of a message into one piece of text.
pub fn text_of(message: &ChatMessage) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.as_str()),
            ContentPart::Image { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The images of a message.
pub fn images_of(message: &ChatMessage) -> Vec<&ContentPart> {
    message
        .content
        .iter()
        .filter(|part| matches!(part, ContentPart::Image { .. }))
        .collect()
}
