//! The assistant's run: ask the model, run the tools it asks for, repeat.
//!
//! This module is the part between the model and the tools: it sends the
//! conversation, reads the answer, runs the tools the assistant asked for,
//! and sends the results back.
//!
//! The tools themselves live in [`crate::ai_tools`], and the renderer lives
//! in [`crate::render`]. Both are in this process, so a tool call never
//! leaves the machine and never waits for a service to answer.
//!
//! Nothing is written to the project here. The tools propose the changes
//! and the user decides, which is what the PRD requires (PRD section 7).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::ai_tools;
use crate::ai_tools::ProposedEdit;
use crate::config::{self, ProviderConfig, ProviderProtocol};
use crate::providers::{
    self, ChatMessage, ContentPart, ProviderEndpoint, ProviderEvent, ProviderRequest, ToolCall,
    ToolDefinition,
};
use crate::render::{Project, ProjectAsset, ProjectFile, ProjectFont};

/// The instructions the assistant works under.
///
/// The rules the PRD sets out are in here: the model never edits the
/// rendered output, every write goes through `propose_edit`, and the model
/// cannot reach outside the project.
const SYSTEM_PROMPT: &str = "\
You are the assistant of a Typst document studio. You help the user write \
and lay out documents.

The project you work on is a folder of Typst source files, a theme file and \
assets. The theme is a Typst file that exports a `theme` function, which \
sets the fonts, the heading styles and the page furniture. You cannot read \
or write anything outside the project, and you cannot run commands.

Rules:
- You never edit a file yourself. Every change goes through the propose_edit \
or propose_style tool, and the user sees the difference and decides whether to \
keep it.
- Read before you write. Use list_sections and read_section to see what the \
document says, and search when you are not sure where something is.
- Use render_preview to check how a change looks. It reports the page count, \
the outline and any warnings the renderer found. After a change that affects \
layout you are shown the rendered pages, so look at them and say what you \
see.
- Be concise. Answer in the fewest words that do the job.
";

/// The instructions for a run that only answers questions.
///
/// The difference between the two modes is what the assistant may do, so
/// the prompt says the same thing about the project but says that no change
/// is being made.
const CHAT_SYSTEM_PROMPT: &str = "\
You are the assistant of a Typst document studio. You answer questions \
about the document the user is working on.

The project is a folder of Typst source files, a theme file and assets. \
You cannot read or write anything outside it, and you cannot run commands.

Rules:
- You answer questions. You do not make changes: no file is edited and no \
style is set, and no change is proposed for the user to accept.
- Read before you answer. Use list_sections and read_section to see what the \
document says, and search when you are not sure where something is.
- Be concise. Answer in the fewest words that do the job.
";

/// The tools the assistant may use when it is only answering questions.
///
/// The provider is only offered these tools, so it cannot ask for one that
/// would change the document.
const READ_ONLY_TOOLS: [&str; 3] = ["list_sections", "read_section", "search"];

/// The request the webview sends to start a run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// The conversation so far, oldest first.
    pub messages: Vec<ChatMessage>,
    /// The project the assistant works on.
    pub project: Project,
    /// The project's text files.
    #[serde(default)]
    pub files: Vec<ProjectFile>,
    /// The project's assets.
    #[serde(default)]
    pub assets: Vec<ProjectAsset>,
    /// The project's fonts.
    #[serde(default)]
    pub fonts: Vec<ProjectFont>,
    /// Which provider to use, when the user picked one.
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Which model to use, when the user picked one.
    #[serde(default)]
    pub model: Option<String>,
    /// How the assistant is running.
    #[serde(default)]
    pub mode: Option<String>,
}

/// What the run tells the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantEvent {
    /// A piece of the answer.
    Text {
        /// The text.
        text: String,
    },
    /// The assistant asked for a tool.
    ToolCall {
        /// The call's identifier.
        id: String,
        /// The tool's name.
        name: String,
        /// The arguments the assistant gave it.
        arguments: serde_json::Value,
    },
    /// What a tool produced.
    ToolResult {
        /// The call's identifier.
        id: String,
        /// The tool's name.
        name: String,
        /// Whether it worked.
        ok: bool,
        /// What it produced.
        result: Option<serde_json::Value>,
        /// Why it failed, when it did.
        error: Option<String>,
    },
    /// A change the assistant proposed.
    Edit {
        /// The change, in the shape the diff view takes.
        edit: serde_json::Value,
    },
    /// The rendered pages the assistant was shown.
    Pages {
        /// How many pages the document has.
        #[serde(rename = "pageCount")]
        page_count: usize,
    },
    /// How much of the model's context the turn used.
    Usage {
        /// The numbers, in the shape the app expects.
        usage: providers::TokenUsage,
    },
    /// The run finished.
    Done,
    /// The run failed.
    Error {
        /// What went wrong.
        message: String,
    },
}

/// How many times the assistant may call tools before it has to answer.
///
/// Without a limit a model that keeps asking for the same tool would run
/// forever. The limit is high enough for real work and low enough that a
/// loop is noticed.
pub const MAX_TOOL_ROUNDS: usize = 12;

/// How many pages are sent back to the model after a layout change.
///
/// The model looks at the pages to see what the change did. Every page of a
/// long document would be a lot of tokens for little gain, so the first few
/// are enough to see the layout.
const MAX_FEEDBACK_PAGES: usize = 3;

/// The flag that stops a run.
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(pub Arc<AtomicBool>);

impl CancelFlag {
    /// Whether the run was asked to stop.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Asks the run to stop.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    /// Lets the next run go.
    pub fn reset(&self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

/// The agent's run.
pub struct Agent {
    /// The provider to talk to.
    provider: ProviderConfig,
    /// Where the provider is reached, and with what key.
    endpoint: ProviderEndpoint,
    /// The model to use.
    model: String,
    /// The tools the assistant may call.
    tools: Vec<ToolDefinition>,
    /// The flag that stops the run.
    cancel: CancelFlag,
}

impl Agent {
    /// The provider to use for a request.
    ///
    /// The provider the user picked wins; otherwise the first one that has a
    /// key is used, so the app works as soon as one provider is set up.
    pub fn choose_provider(
        directory: &std::path::Path,
        request: &ChatRequest,
    ) -> Result<(ProviderConfig, Option<String>), String> {
        let config = config::read_config_from(directory)?;

        let chosen = match &request.provider_id {
            Some(id) => config
                .providers
                .iter()
                .find(|provider| &provider.id == id)
                .cloned()
                .ok_or_else(|| format!("There is no provider called '{id}'."))?,
            None => config
                .providers
                .iter()
                .find(|provider| config::provider_key_in(directory, &provider.id).is_some())
                .cloned()
                .ok_or_else(|| {
                    "No provider is set up. Add one in Settings before using the assistant."
                        .to_string()
                })?,
        };

        let key = config::provider_key_in(directory, &chosen.id);
        Ok((chosen, key))
    }

    /// The model to use for a request.
    pub fn choose_model(request: &ChatRequest, provider: &ProviderConfig) -> String {
        request
            .model
            .clone()
            .filter(|model| !model.trim().is_empty())
            .or_else(|| {
                if provider.model.trim().is_empty() {
                    None
                } else {
                    Some(provider.model.clone())
                }
            })
            .unwrap_or_default()
    }

    /// The tools the assistant may call.
    ///
    /// They are the ones in this process, so the model is told what it may
    /// do rather than what the user typed.
    fn tools(&self) -> Vec<ToolDefinition> {
        ai_tools::tool_descriptions()
    }

    /// Whether a tool call changes the layout.
    ///
    /// The layout only changes when the theme or a file's contents change,
    /// so only those calls are worth rendering again.
    pub fn changes_layout(call: &ToolCall) -> bool {
        match call.name.as_str() {
            "propose_style" => true,
            "render_preview" => true,
            "propose_edit" => call
                .arguments
                .get("path")
                .and_then(|value| value.as_str())
                .map(|path| path.to_ascii_lowercase().ends_with(".typ"))
                .unwrap_or(false),
            _ => false,
        }
    }
}

/// Runs the tools the assistant asked for.
///
/// The calls run against the project that travelled with the request and
/// produce both what each tool returned and the changes the tools proposed.
///
/// The work is CPU-bound, so it is put on a blocking thread: the run must
/// keep answering the provider while the renderer is busy.
async fn run_tools(
    request: ChatRequest,
    calls: Vec<ToolCall>,
) -> Result<(Vec<AssistantEvent>, Vec<ChatMessage>, Vec<ProposedEdit>), String> {
    tokio::task::spawn_blocking(move || {
        let session = ai_tools::run_session(
            request.project,
            request.files,
            request.assets,
            request.fonts,
            &calls,
        );

        let mut events = Vec::new();
        let mut messages = Vec::new();

        for result in &session.calls {
            events.push(AssistantEvent::ToolResult {
                id: result.id.clone(),
                name: result.name.clone(),
                ok: result.ok,
                result: result.result.clone(),
                error: result.error.clone(),
            });

            // The answer the model gets: what the tool produced, or why it
            // did not.
            let text = match (&result.result, &result.error) {
                (_, Some(reason)) => format!("The tool '{}' failed: {reason}", result.name),
                (Some(value), None) => serde_json::to_string(value).unwrap_or_default(),
                (None, None) => String::new(),
            };

            messages.push(ChatMessage {
                role: "tool".to_string(),
                content: vec![ContentPart::Text { text }],
                tool_calls: Vec::new(),
                tool_call_id: Some(result.id.clone()),
                tool_name: Some(result.name.clone()),
            });
        }

        // The changes the tools proposed, which the user decides on.
        for edit in &session.edits {
            events.push(AssistantEvent::Edit {
                edit: serde_json::to_value(edit).unwrap_or(serde_json::Value::Null),
            });
        }

        Ok::<_, String>((events, messages, session.edits))
    })
    .await
    .map_err(|error| format!("The tools did not run: {error}"))?
}

/// Renders the pages, so the assistant can see what a change did.
///
/// The changes the tools proposed are put into the project first, so the
/// pages show the document as it would be if the user keeps them.
async fn render_pages(
    request: ChatRequest,
    edits: Vec<ProposedEdit>,
) -> Result<(Vec<ContentPart>, usize), String> {
    tokio::task::spawn_blocking(move || {
        let mut files = request.files;

        for edit in &edits {
            match files.iter_mut().find(|file| file.path == edit.path) {
                Some(file) => file.text = edit.new_text.clone(),
                None => files.push(ProjectFile {
                    path: edit.path.clone(),
                    text: edit.new_text.clone(),
                }),
            }
        }

        let rendered = crate::render::render_project_pages(&crate::render::RenderRequest {
            project: request.project,
            files,
            assets: request.assets,
            fonts: request.fonts,
        })?;

        let mut parts = Vec::new();

        for page in rendered.pages.iter().take(MAX_FEEDBACK_PAGES) {
            parts.push(ContentPart::Image {
                base64: page.png_base64.clone(),
                mime_type: "image/png".to_string(),
            });
        }

        Ok::<_, String>((parts, rendered.page_count))
    })
    .await
    .map_err(|error| format!("The pages did not render: {error}"))?
}

/// Runs the assistant and streams what happens back to the webview.
///
/// The run ends when the model answers without asking for a tool, when the
/// tool budget runs out, or when the user stops it.
pub async fn run(
    request: ChatRequest,
    channel: Channel<AssistantEvent>,
    cancel: CancelFlag,
) -> Result<(), String> {
    let directory = config::config_directory()?;
    run_in(&directory, request, channel, cancel).await
}

/// Runs the assistant, taking the providers from a folder.
///
/// The folder is a parameter rather than something read from the
/// environment, so a test can run against its own settings without
/// touching the ones the user has.
pub async fn run_in(
    directory: &std::path::Path,
    request: ChatRequest,
    channel: Channel<AssistantEvent>,
    cancel: CancelFlag,
) -> Result<(), String> {
    cancel.reset();

    // The setting that turns the assistant off is honoured here rather than
    // only in the window. The window stops the button from being pressed,
    // but the setting is a promise about the document's contents, and only
    // this side knows what a run would send.
    let config = match config::read_config_from(directory) {
        Ok(config) => config,
        Err(message) => {
            let _ = channel.send(AssistantEvent::Error { message });
            let _ = channel.send(AssistantEvent::Done);
            return Ok(());
        }
    };

    if !config.ai_enabled {
        let _ = channel.send(AssistantEvent::Error {
            message: "The assistant is turned off in the settings, so nothing was sent."
                .to_string(),
        });
        let _ = channel.send(AssistantEvent::Done);
        return Ok(());
    }

    let (provider, api_key) = match Agent::choose_provider(directory, &request) {
        Ok(chosen) => chosen,
        Err(message) => {
            let _ = channel.send(AssistantEvent::Error { message });
            let _ = channel.send(AssistantEvent::Done);
            return Ok(());
        }
    };

    let model = Agent::choose_model(&request, &provider);

    if model.trim().is_empty() {
        let _ = channel.send(AssistantEvent::Error {
            message: format!("The provider '{}' has no model chosen.", provider.name),
        });
        let _ = channel.send(AssistantEvent::Done);
        return Ok(());
    }

    let endpoint = providers::endpoint_for(&provider, api_key);

    let mut agent = Agent {
        provider: provider.clone(),
        endpoint,
        model,
        tools: Vec::new(),
        cancel: cancel.clone(),
    };

    agent.tools = agent.tools();

    // In the chat mode the assistant only answers questions, so it is only
    // offered the tools that read the document. A tool that is not offered
    // cannot be asked for, which is what keeps the mode honest without a
    // second branch in the loop.
    let chat_mode = request.mode.as_deref() == Some("chat");
    if chat_mode {
        agent
            .tools
            .retain(|tool| READ_ONLY_TOOLS.contains(&tool.name.as_str()));
    }

    let system_prompt = if chat_mode {
        CHAT_SYSTEM_PROMPT
    } else {
        SYSTEM_PROMPT
    };

    // The conversation the model is answering, which grows as the tools run.
    let mut messages = request.messages.clone();

    // The changes the assistant has proposed so far.
    //
    // They are not written to the project — the user decides that — but
    // they are put into the pages the model is shown, so that it can see
    // what its own change does.
    let mut proposed: Vec<ProposedEdit> = Vec::new();

    for round in 0..MAX_TOOL_ROUNDS {
        if agent.cancel.is_cancelled() {
            break;
        }

        let provider_request = ProviderRequest {
            system: system_prompt.to_string(),
            messages: messages.clone(),
            tools: agent.tools.clone(),
            model: agent.model.clone(),
        };

        let mut collected = Vec::new();

        let outcome = {
            let mut on_event = |event: ProviderEvent| match event {
                ProviderEvent::Text(text) => {
                    collected.push(AssistantEvent::Text { text: text.clone() });
                }
                ProviderEvent::ToolCall(call) => {
                    collected.push(AssistantEvent::ToolCall {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        arguments: call.arguments.clone(),
                    });
                }
                ProviderEvent::Done => {}
            };

            providers::stream_turn(
                &agent.provider,
                &agent.endpoint,
                &provider_request,
                &mut on_event,
            )
            .await
        };

        let turn = match outcome {
            Ok(turn) => turn,
            Err(error) => {
                let _ = channel.send(AssistantEvent::Error {
                    message: error.message,
                });
                let _ = channel.send(AssistantEvent::Done);
                return Ok(());
            }
        };

        for event in collected {
            let _ = channel.send(event);
        }

        // How much of the context the turn used, when the provider said. The
        // app shows it as a ring next to the model.
        if let Some(usage) = turn.usage {
            let _ = channel.send(AssistantEvent::Usage { usage });
        }

        // What the model said goes back into the conversation, so it can see
        // its own answer.
        messages.push(ChatMessage {
            role: "assistant".to_string(),
            content: if turn.text.is_empty() {
                Vec::new()
            } else {
                vec![ContentPart::Text {
                    text: turn.text.clone(),
                }]
            },
            tool_calls: turn.tool_calls.clone(),
            tool_call_id: None,
            tool_name: None,
        });

        if turn.tool_calls.is_empty() {
            break;
        }

        if agent.cancel.is_cancelled() {
            break;
        }

        match run_tools(request.clone(), turn.tool_calls.clone()).await {
            Ok((events, answers, edits)) => {
                for event in events {
                    let _ = channel.send(event);
                }
                messages.extend(answers);
                proposed.extend(edits);
            }
            Err(message) => {
                let _ = channel.send(AssistantEvent::Error { message });
                break;
            }
        }

        // A change that affects the layout is shown to the model as the
        // rendered pages, so it can see what it did.
        let wants_pages = turn.tool_calls.iter().any(Agent::changes_layout);

        if wants_pages && !agent.cancel.is_cancelled() {
            match render_pages(request.clone(), proposed.clone()).await {
                Ok((parts, page_count)) => {
                    let _ = channel.send(AssistantEvent::Pages { page_count });

                    if !parts.is_empty() && agent.provider.supports_images {
                        let mut content = vec![ContentPart::Text {
                            text: "These are the rendered pages after the change. \
                                   Look at them before you answer."
                                .to_string(),
                        }];
                        content.extend(parts);

                        messages.push(ChatMessage {
                            role: "user".to_string(),
                            content,
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            tool_name: None,
                        });
                    } else {
                        // The model cannot see images, so it is told what
                        // the renderer found instead.
                        messages.push(ChatMessage {
                            role: "user".to_string(),
                            content: vec![ContentPart::Text {
                                text: format!(
                                    "The document rendered to {page_count} pages. \
                                     This model cannot see images, so check the \
                                     render_preview tool for the warnings."
                                ),
                            }],
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            tool_name: None,
                        });
                    }
                }
                Err(message) => {
                    let _ = channel.send(AssistantEvent::Error { message });
                }
            }
        }

        if round + 1 == MAX_TOOL_ROUNDS {
            let _ = channel.send(AssistantEvent::Error {
                message: "The assistant asked for more tools than one run allows. \
                          It was stopped."
                    .to_string(),
            });
        }
    }

    let _ = channel.send(AssistantEvent::Done);
    Ok(())
}

/// Runs the assistant.
#[tauri::command(rename = "run_assistant")]
pub async fn command_run_assistant(
    request: ChatRequest,
    channel: Channel<AssistantEvent>,
    cancel: tauri::State<'_, CancelFlag>,
) -> Result<(), String> {
    run(request, channel, cancel.inner().clone()).await
}

/// Stops the run that is going on.
#[tauri::command(rename = "cancel_assistant")]
pub fn command_cancel_assistant(cancel: tauri::State<'_, CancelFlag>) -> Result<(), String> {
    cancel.inner().cancel();
    Ok(())
}

/// A provider as the settings dialog shows it, ready to be tried.
///
/// The dialog sends the draft rather than the provider that was last
/// saved, so that the test is of what the user is looking at: a provider
/// that has just been added, or one whose address has just been changed,
/// can be tried before the settings are kept.
///
/// The key that was saved is not part of it. The key is looked up by the
/// provider's identifier in the user's home folder, so the webview never
/// holds one. A key that the user has only just typed is sent, because
/// otherwise a provider would be reported as having no key while the key
/// is right there in the form.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTest {
    /// Which provider it is. The key is looked up by this.
    pub id: String,
    /// The name the user gave it.
    #[serde(default)]
    pub name: String,
    /// The wire format it speaks.
    pub protocol: ProviderProtocol,
    /// Where the requests go.
    #[serde(default)]
    pub base_url: String,
    /// The model to ask for.
    #[serde(default)]
    pub model: String,
    /// Whether the provider needs a key.
    #[serde(default = "needs_a_key_by_default")]
    pub requires_key: bool,
    /// The key the user has typed but not yet saved.
    #[serde(default)]
    pub api_key: Option<String>,
}

/// Whether a provider needs a key when the webview does not say.
fn needs_a_key_by_default() -> bool {
    true
}

/// The time a provider is given to answer a test.
///
/// A provider that never answers would otherwise leave the button on
/// "Testing…" for ever, which looks like the app has stopped.
const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Tries a provider and says what came back.
///
/// The directory is given so that a test can be run against a folder of its
/// own rather than against the user's own settings.
pub async fn test_provider_in(
    directory: &std::path::Path,
    test: &ProviderTest,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let config = config::read_config_from(directory)?;
    let saved = config
        .providers
        .iter()
        .find(|provider| provider.id == test.id);

    let name = if test.name.trim().is_empty() {
        saved
            .map(|provider| provider.name.clone())
            .unwrap_or_else(|| test.id.clone())
    } else {
        test.name.clone()
    };

    // A field the user has cleared falls back to the saved one, because a
    // provider with no address has nothing to try.
    let base_url = if test.base_url.trim().is_empty() {
        saved
            .map(|provider| provider.base_url.clone())
            .unwrap_or_default()
    } else {
        test.base_url.clone()
    };

    if base_url.trim().is_empty() {
        return Err(format!("'{name}' has no address to try."));
    }

    let model = if test.model.trim().is_empty() {
        saved
            .map(|provider| provider.model.clone())
            .unwrap_or_default()
    } else {
        test.model.clone()
    };

    // A key the user has typed is used as it is, so that a provider is not
    // reported as having no key while the key is in the form. A key that was
    // saved is used otherwise, and it never travels to the webview.
    let typed = test
        .api_key
        .as_ref()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());

    let key = typed.or_else(|| config::provider_key_in(directory, &test.id));

    if test.requires_key && key.is_none() {
        return Err(format!("'{name}' has no key yet."));
    }

    let provider = ProviderConfig {
        id: test.id.clone(),
        name: name.clone(),
        protocol: test.protocol,
        base_url: base_url.clone(),
        model: model.clone(),
        models: Vec::new(),
        supports_images: false,
        requires_key: test.requires_key,
    };

    let endpoint = providers::endpoint_for(&provider, key);

    let request = ProviderRequest {
        system: "You are checking that the connection works.".to_string(),
        messages: vec![ChatMessage::text("user", "Reply with the word ready.")],
        tools: Vec::new(),
        model,
    };

    let mut answer = String::new();
    let mut on_event = |event: ProviderEvent| {
        if let ProviderEvent::Text(text) = event {
            answer.push_str(&text);
        }
    };

    let outcome = tokio::time::timeout(
        timeout,
        providers::stream_turn(&provider, &endpoint, &request, &mut on_event),
    )
    .await;

    match outcome {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => return Err(error.message),
        Err(_elapsed) => {
            return Err(format!(
                "'{name}' did not answer within {} seconds.",
                timeout.as_secs()
            ));
        }
    }

    if answer.trim().is_empty() {
        return Err(format!("'{name}' answered with nothing."));
    }

    Ok(format!("'{name}' answered: {}", answer.trim()))
}

/// Checks that the provider answers, so the settings dialog can say whether
/// the key works.
///
/// The provider is the one the dialog shows rather than the one that was
/// last saved, so a change can be tried before it is kept.
#[tauri::command(rename = "test_provider")]
pub async fn command_test_provider(test: ProviderTest) -> Result<String, String> {
    test_provider_in(&config::config_directory()?, &test, TEST_TIMEOUT).await
}
