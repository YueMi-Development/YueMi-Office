//! Reading the server-sent events a provider streams.
//!
//! The format is a sequence of lines. A line that starts with `data:`
//! carries a piece of the payload, a line that starts with `event:` names
//! the event, and a blank line ends the event. Several `data:` lines in a
//! row belong to the same event and are joined with a newline.

use serde::Deserialize;

/// One event from a stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    /// The event's name, when it had one.
    pub event: Option<String>,
    /// The event's data, with the `data:` prefix removed.
    pub data: String,
}

/// Reads events out of a stream of bytes.
///
/// The reader is fed whatever arrives and hands back the events that are
/// complete. The bytes of an event can be split across reads, so anything
/// incomplete is held until the rest arrives.
#[derive(Debug, Default)]
pub struct SseReader {
    /// The bytes of the event being read.
    pending: Vec<u8>,
    /// The event's name, when it named itself.
    event: Option<String>,
    /// The event's data lines.
    data: Vec<String>,
}

impl SseReader {
    /// A reader with nothing in it.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds bytes in and returns the events that are now complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.pending.extend_from_slice(bytes);

        let mut events = Vec::new();

        // Only complete lines are read, so a line split across two reads
        // waits for the rest of it.
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=newline).collect();
            let line = &line[..line.len() - 1];
            let line = line.strip_suffix(b"\r").unwrap_or(line);

            if let Some(event) = self.take_line(line) {
                events.push(event);
            }
        }

        events
    }

    /// Takes the events out of the reader once the stream ends.
    ///
    /// A stream that ends without a final blank line still has an event in
    /// it, so it is not thrown away.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut events = Vec::new();

        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            let line = line.strip_suffix(b"\r").unwrap_or(&line);
            if let Some(event) = self.take_line(line) {
                events.push(event);
            }
        }

        if let Some(event) = self.take_event() {
            events.push(event);
        }

        events
    }

    /// Reads one line, and returns the event it ends.
    fn take_line(&mut self, line: &[u8]) -> Option<SseEvent> {
        // A line that starts with a colon is a comment, which providers use
        // to keep the connection open.
        if line.first() == Some(&b':') {
            return None;
        }

        let text = String::from_utf8_lossy(line);

        let (field, value) = match text.split_once(':') {
            Some((field, value)) => {
                // A single space after the colon is part of the format, not
                // the value.
                let value = value.strip_prefix(' ').unwrap_or(value);
                (field, value.to_string())
            }
            None => (text.as_ref(), String::new()),
        };

        match field {
            "event" => self.event = Some(value),
            "data" => self.data.push(value),
            _ => {}
        }

        if line.is_empty() {
            return self.take_event();
        }

        None
    }

    /// Takes the event that has been read, if there is one.
    fn take_event(&mut self) -> Option<SseEvent> {
        if self.data.is_empty() && self.event.is_none() {
            return None;
        }

        let event = SseEvent {
            event: self.event.take(),
            data: self.data.join("\n"),
        };

        self.data.clear();

        Some(event)
    }
}

/// The payload of an OpenAI stream chunk.
///
/// The chunk carries the text of the answer and, when the assistant asks
/// for a tool, the tool's arguments in pieces. The last chunk may also
/// carry how much of the context the turn used.
#[derive(Debug, Deserialize)]
pub struct OpenAiChunk {
    /// The choices of the chunk.
    #[serde(default)]
    pub choices: Vec<OpenAiChoice>,
    /// How much of the context the turn used, when the server said.
    #[serde(default)]
    pub usage: Option<OpenAiUsage>,
}

/// How much of the context a turn used.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct OpenAiUsage {
    /// The tokens the conversation took up.
    #[serde(default)]
    pub prompt_tokens: u64,
    /// The tokens the answer took up.
    #[serde(default)]
    pub completion_tokens: u64,
}

/// One choice of an OpenAI chunk.
#[derive(Debug, Deserialize)]
pub struct OpenAiChoice {
    /// What came with the choice.
    #[serde(default)]
    pub delta: OpenAiDelta,
    /// Why the stream ended, when it did.
    #[serde(default)]
    pub finish_reason: Option<String>,
}

/// What came with an OpenAI choice.
#[derive(Debug, Deserialize, Default)]
pub struct OpenAiDelta {
    /// A piece of the answer.
    #[serde(default)]
    pub content: Option<String>,
    /// The tools the assistant asked for.
    #[serde(default)]
    pub tool_calls: Vec<OpenAiToolCallDelta>,
}

/// One tool call of an OpenAI chunk.
#[derive(Debug, Deserialize)]
pub struct OpenAiToolCallDelta {
    /// Which call this belongs to.
    #[serde(default)]
    pub index: Option<usize>,
    /// The call's identifier.
    #[serde(default)]
    pub id: Option<String>,
    /// The tool's name, which only comes with the first piece.
    #[serde(default)]
    pub function: Option<OpenAiFunctionDelta>,
}

/// The function of an OpenAI tool call.
#[derive(Debug, Deserialize)]
pub struct OpenAiFunctionDelta {
    /// The tool's name.
    #[serde(default)]
    pub name: Option<String>,
    /// A piece of the arguments, as JSON text.
    #[serde(default)]
    pub arguments: Option<String>,
}

/// The payload of an Anthropic stream event.
///
/// Only the parts that are used are described; the rest of the event is
/// ignored rather than rejected, so a provider adding a field does not
/// break the reader.
#[derive(Debug, Deserialize)]
pub struct AnthropicEvent {
    /// What happened.
    #[serde(rename = "type")]
    pub kind: String,
    /// Which content block the event is about.
    #[serde(default)]
    pub index: Option<usize>,
    /// The block the event starts.
    #[serde(default)]
    pub content_block: Option<AnthropicContentBlock>,
    /// What changed in the block.
    #[serde(default)]
    pub delta: Option<AnthropicDelta>,
    /// The whole message, when the event is the end of the turn.
    #[serde(default)]
    pub message: Option<AnthropicMessage>,
    /// How much of the context the turn used, when the event says.
    #[serde(default)]
    pub usage: Option<AnthropicUsage>,
}

/// How much of the context a turn used.
///
/// Anthropic reports the input tokens when the message starts and the
/// output tokens when it ends, so the two are added up as they arrive.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct AnthropicUsage {
    /// The tokens the conversation took up.
    #[serde(default)]
    pub input_tokens: u64,
    /// The tokens the answer took up.
    #[serde(default)]
    pub output_tokens: u64,
    /// The tokens that came from the cache rather than being sent again.
    #[serde(default)]
    pub cache_read_input_tokens: u64,
}

/// A content block of an Anthropic message.
#[derive(Debug, Deserialize)]
pub struct AnthropicContentBlock {
    /// What the block is: `text` or `tool_use`.
    #[serde(rename = "type")]
    pub kind: String,
    /// The block's identifier.
    #[serde(default)]
    pub id: Option<String>,
    /// The tool's name, when the block is a tool call.
    #[serde(default)]
    pub name: Option<String>,
    /// The tool's arguments, when the block is a tool call.
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

/// What changed in an Anthropic content block.
#[derive(Debug, Deserialize)]
pub struct AnthropicDelta {
    /// A piece of the text.
    #[serde(default, rename = "text")]
    pub text: Option<String>,
    /// A piece of the tool's arguments, as JSON text.
    #[serde(default, rename = "partial_json")]
    pub partial_json: Option<String>,
}

/// A whole Anthropic message.
#[derive(Debug, Deserialize)]
pub struct AnthropicMessage {
    /// The message's content blocks.
    #[serde(default)]
    pub content: Vec<AnthropicContentBlock>,
    /// How much of the context the message took up, when the event says.
    #[serde(default)]
    pub usage: Option<AnthropicUsage>,
}
