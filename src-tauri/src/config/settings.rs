use std::fs;
use std::path::PathBuf;

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("mogy");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("settings.json")
}

pub fn load_settings() -> String {
    fs::read_to_string(settings_path()).unwrap_or_else(|_| "{}".to_string())
}
