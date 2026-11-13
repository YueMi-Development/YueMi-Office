//! Anthropic's Messages API.
//!
//! The API streams its answer as a series of events: a message starts, its
//! content blocks start, each block sends pieces, and the message ends.
//! The pieces of a tool call's arguments arrive as JSON text that has to be
//! joined before it can be read.

use serde_json::json;

use super::sse::{AnthropicEvent, SseReader};
use super::{
    ChatMessage, ContentPart, ProviderEndpoint, ProviderError, ProviderEvent, ProviderRequest,
    ProviderTurn, ToolCall, anthropic_headers, text_of,
};

/// The most tokens a tool's arguments may use before they are refused.
///
/// The API asks for a limit, and without one it refuses long tool arguments
/// with a message that says nothing useful. The limit is generous enough
/// for a whole file of text.
const MAX_TOKENS: u64 = 8192;

/// Sends a turn to Anthropic and streams the answer back.
pub async fn stream_turn(
    endpoint: &ProviderEndpoint,
    request: &ProviderRequest,
    on_event: &mut (dyn FnMut(ProviderEvent) + Send),
) -> Result<ProviderTurn, ProviderError> {
    let body = build_body(request);

    let mut response = super::send(
        &format!("{}/v1/messages", endpoint.base_url),
        anthropic_headers(endpoint.api_key.as_deref()),
        &body,
    )
    .await?;

    let mut turn = ProviderTurn::default();

    // The tool calls that are being read, in the order the blocks appeared.
    let mut calls: Vec<PendingCall> = Vec::new();
    let mut reader = SseReader::new();

    while let Some(chunk) = response.chunk().await.map_err(|error| ProviderError {
        message: format!("The connection to Anthropic broke: {error}"),
        status: None,
    })? {
        for event in reader.push(&chunk) {
            handle_event(&event, &mut calls, &mut turn, on_event);
        }
    }

    for event in reader.finish() {
        handle_event(&event, &mut calls, &mut turn, on_event);
    }

    // A tool call whose arguments never arrived is still a tool call: it is
    // reported with no arguments rather than dropped, so the user can see
    // what the assistant tried to do.
    turn.tool_calls = calls
        .into_iter()
        .map(|pending| {
            let arguments = pending.finish();
            ToolCall {
                id: pending.id,
                name: pending.name,
                arguments,
            }
        })
        .collect();

    // The calls are reported once they are whole, because the arguments
    // arrive in pieces and a call with half of its arguments would be of no
    // use to anyone.
    for call in &turn.tool_calls {
        on_event(ProviderEvent::ToolCall(call.clone()));
    }

    on_event(ProviderEvent::Done);

    Ok(turn)
}

/// A tool call that is being read.
pub use super::PendingCall;

/// Reads one event and acts on it.
pub fn handle_event(
    event: &super::sse::SseEvent,
    calls: &mut Vec<PendingCall>,
    turn: &mut ProviderTurn,
    on_event: &mut (dyn FnMut(ProviderEvent) + Send),
) {
    if event.data.is_empty() || event.data == "[DONE]" {
        return;
    }

    let parsed: AnthropicEvent = match serde_json::from_str(&event.data) {
        Ok(parsed) => parsed,
        Err(_) => return,
    };

    match parsed.kind.as_str() {
        "content_block_start" => {
            if let Some(block) = parsed.content_block
                && block.kind == "tool_use"
            {
                let mut call = PendingCall::new();
                call.id = block.id.unwrap_or_default();
                call.name = block.name.unwrap_or_default();
                call.block_index = parsed.index;
                calls.push(call);
            }
        }
        "content_block_delta" => {
            let Some(delta) = parsed.delta else {
                return;
            };

            if let Some(text) = delta.text
                && !text.is_empty()
            {
                turn.text.push_str(&text);
                on_event(ProviderEvent::Text(text));
            }

            if let Some(partial) = delta.partial_json
                && let Some(call) = call_for_block(calls, parsed.index)
            {
                call.push_arguments(&partial);
            }
        }
        // The message starting says how much of the context the conversation
        // took up, and the message ending says how much the answer took up.
        "message_start" => {
            if let Some(usage) = parsed.message.and_then(|message| message.usage) {
                record_usage(turn, usage);
            }
        }
        "message_delta" => {
            if let Some(usage) = parsed.usage {
                record_usage(turn, usage);
            }
        }
        "content_block_stop" => {}
        _ => {}
    }
}

/// Adds what the provider said about the context to the turn.
///
/// The two events report different halves of the same number, so the
/// larger of the two is kept for each: a message that starts says nothing
/// about the answer, and a message that ends says nothing about the
/// conversation.
fn record_usage(turn: &mut ProviderTurn, usage: super::sse::AnthropicUsage) {
    let entry = turn.usage.get_or_insert(super::TokenUsage::default());

    let input = usage.input_tokens + usage.cache_read_input_tokens;
    if input > entry.input_tokens {
        entry.input_tokens = input;
    }
    if usage.output_tokens > entry.output_tokens {
        entry.output_tokens = usage.output_tokens;
    }
}

/// The call that belongs to a content block.
///
/// The blocks are numbered by the provider, and a text block counts towards
/// the numbering, so the call is found by the number of its own block rather
/// than by its place in the list of calls.
fn call_for_block(calls: &mut [PendingCall], index: Option<usize>) -> Option<&mut PendingCall> {
    let index = index?;
    calls
        .iter_mut()
        .find(|call| call.block_index == Some(index))
}

/// Builds the request body.
pub fn build_body(request: &ProviderRequest) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = request.messages.iter().map(build_message).collect();

    let tools: Vec<serde_json::Value> = request
        .tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            })
        })
        .collect();

    json!({
        "model": request.model,
        "max_tokens": MAX_TOKENS,
        "system": request.system,
        "messages": messages,
        "tools": tools,
        "stream": true,
    })
}

/// Builds one message of the request.
pub fn build_message(message: &ChatMessage) -> serde_json::Value {
    // The answer to a tool call is its own message, so it is built here
    // rather than as part of the conversation.
    if message.role == "tool" {
        return json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": message.tool_call_id.clone().unwrap_or_default(),
                "content": text_of(message),
            }],
        });
    }

    let mut content: Vec<serde_json::Value> = Vec::new();

    for part in &message.content {
        match part {
            ContentPart::Text { text } => {
                content.push(json!({ "type": "text", "text": text }));
            }
            ContentPart::Image { base64, mime_type } => {
                content.push(json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64,
                    },
                }));
            }
        }
    }

    for call in &message.tool_calls {
        content.push(json!({
            "type": "tool_use",
            "id": call.id,
            "name": call.name,
            "input": call.arguments,
        }));
    }

    if content.is_empty() {
        content.push(json!({ "type": "text", "text": "" }));
    }

    json!({ "role": message.role, "content": content })
}
