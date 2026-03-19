use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub connection: Option<String>,
    pub database: Option<String>,
    pub collection: Option<String>,
    #[serde(default)]
    pub last_editor_content: Option<String>,
    #[serde(default)]
    pub current_file: Option<String>,
    #[serde(default)]
    pub layout_direction: Option<String>,
    #[serde(default)]
    pub color_scheme: Option<String>,
    #[serde(default)]
    pub lightweight_editor: Option<bool>,
    #[serde(default)]
    pub cached_databases: Option<Vec<String>>,
    #[serde(default)]
    pub cached_collections: Option<Vec<String>>,
}

fn session_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("mogy");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("session.json")
}

pub fn load_session() -> Session {
    let path = session_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Session::default(),
    }
}

pub fn save_session(session: &Session) -> Result<(), String> {
    let path = session_path();
    let json = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
