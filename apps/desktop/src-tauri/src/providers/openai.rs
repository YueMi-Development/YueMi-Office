//! OpenAI's Chat Completions API, and every other server that speaks it.
//!
//! The answer arrives as chunks of JSON, each carrying a piece of the text
//! or a piece of a tool call's arguments. The arguments of a tool call
//! arrive as JSON text in pieces, which are joined before they are read.

use serde_json::json;

use super::sse::{OpenAiChunk, SseReader};
use super::{
    openai_headers, text_of, ChatMessage, ContentPart, ProviderEndpoint, ProviderError,
    ProviderEvent, ProviderRequest, ProviderTurn, ToolCall,
};

/// Sends a turn to an OpenAI-compatible server and streams the answer back.
pub async fn stream_turn(
    endpoint: &ProviderEndpoint,
    request: &ProviderRequest,
    on_event: &mut (dyn FnMut(ProviderEvent) + Send),
) -> Result<ProviderTurn, ProviderError> {
    let body = build_body(request);

    let mut response = super::send(
        &format!("{}/chat/completions", endpoint.base_url),
        openai_headers(endpoint.api_key.as_deref()),
        &body,
    )
    .await?;

    let mut turn = ProviderTurn::default();

    // The tool calls that are being read. They are kept in one list and
    // indexed by the index the server gave them, because the pieces of a
    // call can arrive in any order.
    let mut calls: Vec<PendingCall> = Vec::new();
    let mut reader = SseReader::new();

    while let Some(chunk) = response.chunk().await.map_err(|error| ProviderError {
        message: format!("The connection to the provider broke: {error}"),
        status: None,
    })? {
        for event in reader.push(&chunk) {
            handle_event(&event, &mut calls, &mut turn, on_event);
        }
    }

    for event in reader.finish() {
        handle_event(&event, &mut calls, &mut turn, on_event);
    }

    turn.tool_calls = calls
        .into_iter()
        .filter(|pending| !pending.name.is_empty())
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

    let parsed: OpenAiChunk = match serde_json::from_str(&event.data) {
        Ok(parsed) => parsed,
        Err(_) => return,
    };

    for choice in &parsed.choices {
        if let Some(text) = &choice.delta.content {
            if !text.is_empty() {
                turn.text.push_str(text);
                on_event(ProviderEvent::Text(text.clone()));
            }
        }

        for delta in &choice.delta.tool_calls {
            let index = delta.index.unwrap_or(0);

            while calls.len() <= index {
                let mut call = PendingCall::new();
                call.block_index = Some(index);
                calls.push(call);
            }

            let call = &mut calls[index];

            if let Some(id) = &delta.id {
                call.id = id.clone();
            }

            if let Some(function) = &delta.function {
                if let Some(name) = &function.name {
                    call.name = name.clone();
                }
                if let Some(arguments) = &function.arguments {
                    call.arguments.push_str(arguments);
                }
            }
        }
    }
}

/// Builds the request body.
pub fn build_body(request: &ProviderRequest) -> serde_json::Value {
    let mut messages: Vec<serde_json::Value> = Vec::new();

    if !request.system.is_empty() {
        messages.push(json!({
            "role": "system",
            "content": request.system,
        }));
    }

    for message in &request.messages {
        messages.push(build_message(message));
    }

    let tools: Vec<serde_json::Value> = request
        .tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            })
        })
        .collect();

    json!({
        "model": request.model,
        "messages": messages,
        "tools": tools,
        "stream": true,
    })
}

/// Builds one message of the request.
pub fn build_message(message: &ChatMessage) -> serde_json::Value {
    if message.role == "tool" {
        return json!({
            "role": "tool",
            "tool_call_id": message.tool_call_id.clone().unwrap_or_default(),
            "content": text_of(message),
        });
    }

    let has_image = message
        .content
        .iter()
        .any(|part| matches!(part, ContentPart::Image { .. }));

    let content = if has_image {
        // A message with an image is a list of parts, because the text and
        // the image are told apart.
        serde_json::Value::Array(
            message
                .content
                .iter()
                .map(|part| match part {
                    ContentPart::Text { text } => json!({
                        "type": "text",
                        "text": text,
                    }),
                    ContentPart::Image { base64, mime_type } => json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{mime_type};base64,{base64}"),
                        },
                    }),
                })
                .collect::<Vec<_>>(),
        )
    } else {
        // A message with only text carries the text itself, which is what
        // the API expects for a message that carries no image.
        json!(text_of(message))
    };

    let mut built = json!({
        "role": message.role,
        "content": content,
    });

    if !message.tool_calls.is_empty() {
        let calls: Vec<serde_json::Value> = message
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments.to_string(),
                    },
                })
            })
            .collect();

        built
            .as_object_mut()
            .expect("a message is an object")
            .insert("tool_calls".to_string(), json!(calls));
    }

    built
}
