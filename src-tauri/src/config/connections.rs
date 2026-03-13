use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub name: String,
    pub uri: String,
}

fn config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("~/.config"))
        .join("mogy");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("connections.json")
}

pub fn load_connections() -> Vec<ConnectionConfig> {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_connections(connections: &[ConnectionConfig]) -> Result<(), String> {
    let path = config_path();
    let json = serde_json::to_string_pretty(connections).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
