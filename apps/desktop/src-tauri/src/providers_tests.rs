//! Tests for the provider clients.
//!
//! The tests use the frames the real providers send, so a change in how a
//! frame is read shows up here rather than in a run against a live provider.

use crate::testing::providers::{anthropic, openai, sse};
use crate::testing::{
    ChatMessage, ContentPart, PendingCall, ProviderEvent, ProviderRequest, ProviderTurn,
    ToolCall, ToolDefinition,
};
use serde_json::json;

/// The tools a request offers.
fn tools() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        name: "read_section".to_string(),
        description: "Read a section.".to_string(),
        parameters: json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"],
        }),
    }]
}

/// A request with one user message.
fn request() -> ProviderRequest {
    ProviderRequest {
        system: "Be brief.".to_string(),
        messages: vec![ChatMessage::text("user", "List the sections.")],
        tools: tools(),
        model: "a-model".to_string(),
    }
}

/// Reads the events of a stream.
fn read_events(text: &str) -> Vec<sse::SseEvent> {
    let mut reader = sse::SseReader::new();
    let mut events = reader.push(text.as_bytes());
    events.extend(reader.finish());
    events
}

// The stream of events, not of bytes.

#[test]
fn an_event_is_read_when_the_blank_line_ends_it() {
    let events = read_events("event: ping\ndata: hello\n\n");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event.as_deref(), Some("ping"));
    assert_eq!(events[0].data, "hello");
}

#[test]
fn an_event_that_is_split_across_reads_is_waited_for() {
    let mut reader = sse::SseReader::new();

    let first = reader.push(b"data: hel");
    let second = reader.push(b"lo\n\n");

    assert!(first.is_empty());
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].data, "hello");
}

#[test]
fn several_data_lines_belong_to_one_event() {
    let events = read_events("data: one\ndata: two\n\n");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "one\ntwo");
}

#[test]
fn a_comment_is_not_an_event() {
    let events = read_events(": keep-alive\ndata: hello\n\n");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "hello");
}

#[test]
fn an_event_that_ends_without_a_blank_line_is_not_thrown_away() {
    let mut reader = sse::SseReader::new();

    reader.push(b"data: hello\n");
    let events = reader.finish();

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "hello");
}

#[test]
fn a_line_without_a_colon_is_read_as_a_field_with_no_value() {
    let events = read_events("data\n\n");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "");
}

// The Anthropic format.

#[test]
fn the_anthropic_body_carries_the_system_the_model_and_the_tools() {
    let body = anthropic::build_body(&request());

    assert_eq!(body["model"], "a-model");
    assert_eq!(body["system"], "Be brief.");
    assert_eq!(body["stream"], true);
    assert_eq!(body["tools"][0]["name"], "read_section");
    assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
}

#[test]
fn the_anthropic_body_sends_a_tool_result_as_its_own_message() {
    let message = ChatMessage {
        role: "tool".to_string(),
        content: vec![ContentPart::Text {
            text: "the answer".to_string(),
        }],
        tool_calls: Vec::new(),
        tool_call_id: Some("call-1".to_string()),
        tool_name: Some("read_section".to_string()),
    };

    let body = anthropic::build_message(&message);

    assert_eq!(body["role"], "user");
    assert_eq!(body["content"][0]["type"], "tool_result");
    assert_eq!(body["content"][0]["tool_use_id"], "call-1");
    assert_eq!(body["content"][0]["content"], "the answer");
}

#[test]
fn the_anthropic_body_sends_an_image_as_base64() {
    let message = ChatMessage {
        role: "user".to_string(),
        content: vec![ContentPart::Image {
            base64: "aGk=".to_string(),
            mime_type: "image/png".to_string(),
        }],
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
    };

    let body = anthropic::build_message(&message);

    assert_eq!(body["content"][0]["type"], "image");
    assert_eq!(body["content"][0]["source"]["media_type"], "image/png");
    assert_eq!(body["content"][0]["source"]["data"], "aGk=");
}

#[test]
fn the_anthropic_stream_gives_the_text_of_the_answer() {
    let stream = concat!(
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello \"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"there\"}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();
    let mut seen: Vec<ProviderEvent> = Vec::new();

    for event in read_events(stream) {
        anthropic::handle_event(&event, &mut calls, &mut turn, &mut |event| seen.push(event));
    }

    assert_eq!(turn.text, "Hello there");
    assert_eq!(seen.len(), 2);
    assert!(matches!(seen[0], ProviderEvent::Text(_)));
}

#[test]
fn the_anthropic_stream_gives_a_tool_call_with_its_arguments() {
    let stream = concat!(
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"read_section\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"a.md\\\"}\"}}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        anthropic::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "toolu_1");
    assert_eq!(calls[0].name, "read_section");
    assert_eq!(calls[0].finish()["path"], "a.md");
}

#[test]
fn a_frame_that_is_not_json_is_skipped_rather_than_stopping_the_run() {
    let stream = concat!(
        "data: not json\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"kept\"}}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        anthropic::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    assert_eq!(turn.text, "kept");
}

// The OpenAI format.

#[test]
fn the_openai_body_carries_the_system_as_a_message() {
    let body = openai::build_body(&request());

    assert_eq!(body["model"], "a-model");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][0]["content"], "Be brief.");
    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(body["tools"][0]["type"], "function");
    assert_eq!(body["tools"][0]["function"]["name"], "read_section");
    assert_eq!(body["tools"][0]["function"]["parameters"]["type"], "object");
}

#[test]
fn the_openai_body_sends_a_tool_result_with_its_call_id() {
    let message = ChatMessage {
        role: "tool".to_string(),
        content: vec![ContentPart::Text {
            text: "the answer".to_string(),
        }],
        tool_calls: Vec::new(),
        tool_call_id: Some("call-1".to_string()),
        tool_name: Some("read_section".to_string()),
    };

    let body = openai::build_message(&message);

    assert_eq!(body["role"], "tool");
    assert_eq!(body["tool_call_id"], "call-1");
    assert_eq!(body["content"], "the answer");
}

#[test]
fn the_openai_body_sends_an_image_as_a_data_url() {
    let message = ChatMessage {
        role: "user".to_string(),
        content: vec![ContentPart::Text {
            text: "look".to_string(),
        }, ContentPart::Image {
            base64: "aGk=".to_string(),
            mime_type: "image/png".to_string(),
        }],
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
    };

    let body = openai::build_message(&message);

    assert_eq!(body["content"][0]["type"], "text");
    assert_eq!(body["content"][1]["type"], "image_url");
    assert_eq!(
        body["content"][1]["image_url"]["url"],
        "data:image/png;base64,aGk="
    );
}

#[test]
fn the_openai_stream_gives_the_text_of_the_answer() {
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\n\n",
        "data: [DONE]\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();
    let mut seen: Vec<ProviderEvent> = Vec::new();

    for event in read_events(stream) {
        openai::handle_event(&event, &mut calls, &mut turn, &mut |event| seen.push(event));
    }

    assert_eq!(turn.text, "Hello there");
    assert_eq!(seen.len(), 2);
}

#[test]
fn the_openai_stream_joins_the_pieces_of_a_tool_call() {
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"read_section\",\"arguments\":\"{\\\"pa\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\":\\\"a.md\\\"}\"}}]}}]}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        openai::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call_1");
    assert_eq!(calls[0].name, "read_section");
    assert_eq!(calls[0].finish()["path"], "a.md");
}

#[test]
fn the_openai_stream_keeps_two_tool_calls_apart() {
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"one\",\"function\":{\"name\":\"first\",\"arguments\":\"{}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"two\",\"function\":{\"name\":\"second\",\"arguments\":\"{}\"}}]}}]}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        openai::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].name, "first");
    assert_eq!(calls[1].name, "second");
}

// The parts both formats share.

#[test]
fn a_tool_call_with_no_arguments_has_empty_arguments() {
    let call = PendingCall::new();

    assert_eq!(call.finish(), json!({}));
}

#[test]
fn arguments_that_are_not_json_are_reported_as_no_arguments() {
    let mut call = PendingCall::new();
    call.push_arguments("not json");

    assert_eq!(call.finish(), json!({}));
}

#[test]
fn a_tool_call_keeps_the_arguments_it_was_given() {
    let call = ToolCall {
        id: "call-1".to_string(),
        name: "search".to_string(),
        arguments: json!({ "query": "the" }),
    };

    assert_eq!(call.arguments["query"], "the");
}

// How much of the context a turn used.

#[test]
fn the_anthropic_stream_reports_the_input_tokens_when_the_message_starts() {
    let stream = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1200,\"cache_read_input_tokens\":300}}}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        anthropic::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    let usage = turn.usage.expect("the usage of the turn");
    assert_eq!(usage.input_tokens, 1500);
    assert_eq!(usage.output_tokens, 0);
}

#[test]
fn the_anthropic_stream_reports_the_output_tokens_when_the_message_ends() {
    let stream = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1200}}}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":40}}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        anthropic::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    let usage = turn.usage.expect("the usage of the turn");
    assert_eq!(usage.input_tokens, 1200);
    assert_eq!(usage.output_tokens, 40);
}

#[test]
fn the_openai_stream_reports_the_usage_of_the_turn() {
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello.\"}}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1200,\"completion_tokens\":40}}\n\n",
    );

    let mut calls: Vec<PendingCall> = Vec::new();
    let mut turn = ProviderTurn::default();

    for event in read_events(stream) {
        openai::handle_event(&event, &mut calls, &mut turn, &mut |_| {});
    }

    let usage = turn.usage.expect("the usage of the turn");
    assert_eq!(usage.input_tokens, 1200);
    assert_eq!(usage.output_tokens, 40);
}

#[test]
fn the_openai_body_asks_for_the_usage() {
    let body = openai::build_body(&request());

    assert_eq!(body["stream_options"]["include_usage"], true);
}
