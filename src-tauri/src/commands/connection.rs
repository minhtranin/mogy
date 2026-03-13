use crate::config::connections::{self, ConnectionConfig};
use crate::config::session::{self, Session};
use crate::config::settings;
use crate::db::client::MongoState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct ConnectResult {
    pub name: String,
    pub default_database: Option<String>,
}

/// Extract the database name from a MongoDB URI path component
fn extract_default_database(uri: &str) -> Option<String> {
    // mongodb://user:pass@host:port/database?options
    // mongodb+srv://user:pass@host/database?options
    let without_scheme = uri
        .strip_prefix("mongodb+srv://")
        .or_else(|| uri.strip_prefix("mongodb://"))?;

    // Find the first '/' after the host (skip any in credentials)
    let after_host = if let Some(at_pos) = without_scheme.find('@') {
        &without_scheme[at_pos + 1..]
    } else {
        without_scheme
    };

    let db_part = after_host.split('/').nth(1)?;
    let db_name = db_part.split('?').next().unwrap_or(db_part);

    if db_name.is_empty() {
        None
    } else {
        Some(db_name.to_string())
    }
}

#[tauri::command]
pub async fn list_connections() -> Result<Vec<ConnectionConfig>, String> {
    Ok(connections::load_connections())
}

#[tauri::command]
pub async fn save_connection(name: String, uri: String) -> Result<(), String> {
    let mut conns = connections::load_connections();

    if let Some(existing) = conns.iter_mut().find(|c| c.name == name) {
        existing.uri = uri;
    } else {
        conns.push(ConnectionConfig { name, uri });
    }

    connections::save_connections(&conns)
}

#[tauri::command]
pub async fn delete_connection(name: String) -> Result<(), String> {
    let mut conns = connections::load_connections();
    conns.retain(|c| c.name != name);
    connections::save_connections(&conns)
}

#[tauri::command]
pub async fn connect(
    name: String,
    state: State<'_, MongoState>,
) -> Result<ConnectResult, String> {
    let conns = connections::load_connections();
    let conn = conns
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| format!("Connection '{}' not found", name))?;

    let default_db = extract_default_database(&conn.uri);

    state.connect(&conn.uri, &name).await?;
    Ok(ConnectResult {
        name,
        default_database: default_db,
    })
}

#[tauri::command]
pub async fn disconnect(state: State<'_, MongoState>) -> Result<(), String> {
    state.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn get_active_connection(
    state: State<'_, MongoState>,
) -> Result<Option<String>, String> {
    Ok(state.active_connection.lock().await.clone())
}

#[tauri::command]
pub async fn load_session_cmd() -> Result<Session, String> {
    Ok(session::load_session())
}

#[tauri::command]
pub async fn load_settings_cmd() -> Result<String, String> {
    Ok(settings::load_settings())
}

#[tauri::command]
pub async fn save_session_cmd(
    connection: Option<String>,
    database: Option<String>,
    collection: Option<String>,
    last_editor_content: Option<String>,
) -> Result<(), String> {
    session::save_session(&Session {
        connection,
        database,
        collection,
        last_editor_content,
    })
}
