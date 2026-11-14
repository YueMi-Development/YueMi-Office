mod ai_tools;
mod assistant;
mod config;
mod diff;
mod models_catalog;
mod project;
mod project_folder;
pub mod providers;
mod render;

#[cfg(test)]
mod ai_tools_tests;
#[cfg(test)]
mod assistant_provider_tests;
#[cfg(test)]
mod assistant_run_tests;
#[cfg(test)]
mod assistant_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod diff_tests;
#[cfg(test)]
mod models_catalog_tests;
#[cfg(test)]
mod project_tests;
#[cfg(test)]
mod providers_error_tests;
#[cfg(test)]
mod providers_http_tests;
#[cfg(test)]
mod providers_tests;
#[cfg(test)]
mod render_tests;
#[cfg(test)]
mod test_support;

/// The filesystem commands, exposed so they can be tested directly.
pub mod testing {
    pub use crate::ai_tools::{
        Fixture, FixtureCase, ProposedEdit, Section, ToolCallResult, ToolContext, ToolSession,
        build_fixture, find_sections, run_session, run_tool, tool_descriptions, tool_names,
        write_assistant_fixture,
    };
    pub use crate::assistant::{
        Agent, AssistantEvent, CancelFlag, ChatRequest, MAX_TOOL_ROUNDS, ProviderTest, run, run_in,
        test_provider_in,
    };
    pub use crate::config::{
        AppConfig, AppConfigView, ProviderConfig, ProviderProtocol, ProviderView, config_view_from,
        provider_key, provider_key_in, read_config, read_config_from, read_credentials,
        read_credentials_from, set_provider_key, set_provider_key_in, write_config,
        write_config_to, write_credentials_to,
    };
    pub use crate::diff::{
        DEFAULT_CONTEXT, DiffChange, DiffHunk, DiffLine, DiffLineKind, apply_changes, diff_hunks,
        split_lines,
    };
    pub use crate::project::{
        collect_project_binaries, create_project, export_binary_file, export_text_file,
        open_project, read_binary_file, save_project, write_project_file,
    };
    pub use crate::project_folder::load_project_folder;
    pub use crate::providers;
    pub use crate::providers::{
        ChatMessage, ContentPart, PendingCall, ProviderEndpoint, ProviderError, ProviderEvent,
        ProviderRequest, ProviderTurn, ToolCall, ToolDefinition, anthropic, openai, sse,
    };
    pub use crate::render::{
        MAX_RENDERED_PAGES, OutlineEntry, PageConfig, PdfConfig, Project, ProjectAsset,
        ProjectFile, ProjectFont, RenderOutline, RenderPage, RenderPages, RenderRequest,
        RenderWarning, render_project, render_project_outline, render_project_pages,
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(assistant::CancelFlag::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::command_open_project,
            project::command_save_project,
            project::command_write_project_file,
            project::command_export_text_file,
            project::command_export_binary_file,
            project::command_read_binary_file,
            project::command_collect_project_binaries,
            project::command_create_project,
            config::command_load_app_config,
            config::command_save_app_config,
            config::command_set_provider_key,
            config::command_config_directory,
            render::command_render_project,
            render::command_render_project_pages,
            render::command_render_project_outline,
            render::command_render_health,
            ai_tools::command_list_ai_tools,
            ai_tools::command_run_ai_session,
            assistant::command_run_assistant,
            assistant::command_cancel_assistant,
            assistant::command_test_provider,
            models_catalog::command_model_context_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
