use crate::audio::{
    list_output_devices, load_settings, save_settings, AudiophileSettings, ListDevicesResponse,
    NativePlaybackStatus, NativePlayer,
};
use crate::cast_browser_server::{CastBrowserServerState, open_url_in_browser};
use crate::local_server::LocalServerState;
use parking_lot::Mutex;
use tauri::{AppHandle, State};

pub struct AppState {
    pub player: Mutex<NativePlayer>,
}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<ListDevicesResponse, String> {
    list_output_devices()
}

#[tauri::command]
pub fn get_audiophile_settings(app: AppHandle) -> Result<AudiophileSettings, String> {
    Ok(load_settings(&app))
}

#[tauri::command]
pub fn set_audiophile_settings(app: AppHandle, settings: AudiophileSettings) -> Result<(), String> {
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn native_play_url(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    let settings = load_settings(&app);
    if !settings.enabled {
        return Err("Audiophile playback is disabled".to_string());
    }
    state.player.lock().play_url(
        url,
        settings.device_id.clone(),
        settings.exclusive_mode,
    )
}

#[tauri::command]
pub fn native_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().pause();
    Ok(())
}

#[tauri::command]
pub fn native_resume(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().resume();
    Ok(())
}

#[tauri::command]
pub fn native_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.player.lock().stop();
    Ok(())
}

#[tauri::command]
pub fn native_seek(state: State<'_, AppState>, seconds: f64) -> Result<(), String> {
    state.player.lock().seek(seconds);
    Ok(())
}

#[tauri::command]
pub fn native_playback_status(state: State<'_, AppState>) -> Result<NativePlaybackStatus, String> {
    Ok(state.player.lock().status())
}

#[tauri::command]
pub fn start_local_server(state: State<'_, LocalServerState>) -> Result<(), String> {
    crate::local_server::start_local_server(&state)
}

#[tauri::command]
pub fn stop_local_server(state: State<'_, LocalServerState>) -> Result<(), String> {
    crate::local_server::stop_local_server(&state)
}

#[tauri::command]
pub fn local_server_managed_running(state: State<'_, LocalServerState>) -> bool {
    crate::local_server::local_server_managed_running(&state)
}

#[tauri::command]
pub fn ensure_cast_browser_server(
    app: AppHandle,
    state: State<'_, CastBrowserServerState>,
) -> Result<String, String> {
    crate::cast_browser_server::ensure_cast_browser_server(&app, &state)
}

#[tauri::command]
pub fn open_cast_in_browser(
    app: AppHandle,
    state: State<'_, CastBrowserServerState>,
    browser: Option<String>,
) -> Result<String, String> {
    let url = crate::cast_browser_server::ensure_cast_browser_server(&app, &state)?;
    let browser_key = browser.as_deref().filter(|b| *b != "default");
    open_url_in_browser(&url, browser_key)?;
    Ok(url)
}

#[tauri::command]
pub fn fetch_identity() -> Result<String, String> {
    crate::identity::get_device_fingerprint()
}

#[tauri::command]
pub fn audiophile_platform_support() -> serde_json::Value {
    let os = std::env::consts::OS;
    let (supported, exclusive, message, backend) = match os {
        "windows" => (
            true,
            true,
            "WASAPI exclusive bit-perfect playback available.",
            "wasapi",
        ),
        "macos" => (
            false,
            false,
            "macOS desktop builds are not supported in this release. Use shared Web Audio.",
            "none",
        ),
        "linux" => linux_audiophile_info(),
        _ => (
            false,
            false,
            "Native audiophile playback not available on this platform.",
            "none",
        ),
    };

    serde_json::json!({
        "os": os,
        "supported": supported,
        "exclusiveAvailable": exclusive,
        "message": message,
        "backend": backend,
    })
}

#[cfg(target_os = "linux")]
fn linux_audiophile_info() -> (bool, bool, &'static str, &'static str) {
    if pipewire_runtime_available() {
        (
            true,
            false,
            "Native PCM output via PipeWire (ALSA compat). Select output device in Settings.",
            "pipewire",
        )
    } else {
        (
            true,
            false,
            "Native PCM output via ALSA. Select output device in Settings.",
            "alsa",
        )
    }
}

#[cfg(not(target_os = "linux"))]
fn linux_audiophile_info() -> (bool, bool, &'static str, &'static str) {
    (false, false, "", "none")
}

#[cfg(target_os = "linux")]
fn pipewire_runtime_available() -> bool {
    if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
        if std::path::Path::new(&runtime).join("pipewire-0").exists() {
            return true;
        }
    }
    false
}
