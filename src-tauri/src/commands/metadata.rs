use crate::db::client::MongoState;
use tauri::State;

#[tauri::command]
pub async fn list_databases(state: State<'_, MongoState>) -> Result<Vec<String>, String> {
    let client = state.get_client().await?;
    client
        .list_database_names()
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))
}

#[tauri::command]
pub async fn list_collections(
    db: String,
    state: State<'_, MongoState>,
) -> Result<Vec<String>, String> {
    let client = state.get_client().await?;
    client
        .database(&db)
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))
}
