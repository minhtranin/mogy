mod commands;
mod config;
mod db;

use db::client::MongoState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MongoState::new())
        .setup(|app| {
            app.handle().plugin(tauri_plugin_clipboard_manager::init())?;
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
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::get_active_connection,
            commands::connection::load_session_cmd,
            commands::connection::save_session_cmd,
            commands::connection::load_settings_cmd,
            commands::metadata::list_databases,
            commands::metadata::list_collections,
            commands::query::execute_query,
            commands::query::execute_raw_query,
            commands::query::update_document,
            commands::files::save_query_file,
            commands::files::load_query_file,
            commands::files::list_query_files,
            commands::files::delete_query_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
