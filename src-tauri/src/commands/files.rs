use std::fs;
use std::path::PathBuf;

fn queries_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("mogy")
        .join("queries");
    fs::create_dir_all(&dir).ok();
    dir
}

#[tauri::command]
pub async fn save_query_file(filename: String, content: String) -> Result<(), String> {
    let path = queries_dir().join(&filename);
    fs::write(&path, &content).map_err(|e| format!("Failed to save: {}", e))
}

#[tauri::command]
pub async fn load_query_file(filename: String) -> Result<String, String> {
    let path = queries_dir().join(&filename);
    fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))
}

#[tauri::command]
pub async fn list_query_files() -> Result<Vec<String>, String> {
    let dir = queries_dir();
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".mongodb.js") || name.ends_with(".js") {
                    files.push(name.to_string());
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub async fn delete_query_file(filename: String) -> Result<(), String> {
    let path = queries_dir().join(&filename);
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))
}
