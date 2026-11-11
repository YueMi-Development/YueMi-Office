mod project;

#[cfg(test)]
mod project_tests;

/// The filesystem commands, exposed so they can be tested directly.
pub mod testing {
    pub use crate::project::{
        collect_project_binaries, create_project, export_binary_file, export_text_file,
        open_project, read_binary_file, save_project, write_project_file,
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
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
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
