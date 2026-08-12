mod audio;
mod commands;
mod identity;
pub mod library_fs;
mod infrastructure;
mod cast_browser_server;
mod local_server;

pub use infrastructure::InfrastructureRegistry;

use audio::NativePlayer;
use commands::AppState;
use parking_lot::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(resource_dir) = app.path().resource_dir() {
                std::env::set_var("SANDBOX_TIER34_RESOURCE", resource_dir);
            }
            identity::init_device_identity(&app.handle())?;
            Ok(())
        })
        .manage(AppState {
            player: Mutex::new(NativePlayer::new()),
        })
        .manage(local_server::LocalServerState::new())
        .manage(cast_browser_server::CastBrowserServerState::new())
        .manage(library_fs::LibraryFsState::new())
        .manage(library_fs::media_server::MediaServerState::new())
        .manage(library_fs::ingest::IngestWatchState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_audio_output_devices,
            commands::get_audiophile_settings,
            commands::set_audiophile_settings,
            commands::native_play_url,
            commands::native_pause,
            commands::native_resume,
            commands::native_stop,
            commands::native_seek,
            commands::native_playback_status,
            commands::audiophile_platform_support,
            commands::start_local_server,
            commands::stop_local_server,
            commands::local_server_managed_running,
            commands::ensure_cast_browser_server,
            commands::open_cast_in_browser,
            commands::fetch_identity,
            library_fs::library_roots_list,
            library_fs::library_root_add,
            library_fs::library_root_remove,
            library_fs::library_scan,
            library_fs::library_stat,
            library_fs::library_plan,
            library_fs::library_apply,
            library_fs::library_undo_last,
            library_fs::library_media_url,
            library_fs::library_tags_plan,
            library_fs::library_tags_write,
            library_fs::library_ingest_scan,
            library_fs::library_ingest_apply,
            library_fs::library_ingest_watch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<local_server::LocalServerState>() {
                    let _ = local_server::stop_local_server(&state);
                }
            }
        });
}
