use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiophileSettings {
    pub enabled: bool,
    pub device_id: Option<String>,
    pub exclusive_mode: bool,
}

impl Default for AudiophileSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            device_id: None,
            exclusive_mode: true,
        }
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("audiophile_settings.json")
}

pub fn load_settings(app: &AppHandle) -> AudiophileSettings {
    let path = settings_path(app);
    if !path.exists() {
        return AudiophileSettings::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &AudiophileSettings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}
