use crate::config::connections::{self, ConnectionConfig};
use crate::db::client::MongoState;
use tauri::State;

#[tauri::command]
pub async fn list_connections() -> Result<Vec<ConnectionConfig>, String> {
    Ok(connections::load_connections())
}

#[tauri::command]
pub async fn save_connection(name: String, uri: String) -> Result<(), String> {
    let mut conns = connections::load_connections();

    // Update if exists, otherwise add
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
pub async fn connect(name: String, state: State<'_, MongoState>) -> Result<String, String> {
    let conns = connections::load_connections();
    let conn = conns
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| format!("Connection '{}' not found", name))?;

    state.connect(&conn.uri, &name).await?;
    Ok(name)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, MongoState>) -> Result<(), String> {
    state.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn get_active_connection(state: State<'_, MongoState>) -> Result<Option<String>, String> {
    Ok(state.active_connection.lock().await.clone())
}
