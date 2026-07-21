/**
 * Routes non-secret UI prefs to localStorage or sessionStorage per Defense → Data Persistence.
 */

import { loadSecuritySettings } from './securitySettings';

/** Keys that follow Data Persistence (theme + playback prefs). */
export const PERSISTED_PREF_KEYS = [
  'sandbox_fidelity_policy',
  'sandbox_is_casting',
  'sandbox_gapless',
  'sandbox_crossfade',
  'sandbox_device_capacity',
  'sandbox_stream_cache_enabled',
  'sandbox_stream_cache_limit_mb',
  'sandbox_aggressive_offline_cache',
  'sandbox_aggressive_cache_max_mb',
  'sandbox_network_sync',
  'sandbox_connect_role',
  'sandbox_connect_device_id',
  'sandbox_connect_device_name',
  'sandbox_connect_setup_done',
  'sandbox_theme_tone',
  'sandbox_language',
  'sandbox_accent_hex',
  'sandbox_font',
  'sandbox_border_radius',
  'cardScale',
  'sandbox_engine_theme_v1',
  'isProAudioEnabled',
  'sandbox_podcasts_enabled',
  'sandbox_tier34_backend_url',
  'sandbox_search_sort_order',
  'sandbox_search_history_v1',
  'sandbox_download_tier_pref',
  'sandbox_platform_typography',
  'sandbox_locker_sync_settings',
  'sandbox_collection_preferred_editions',
  'sandbox_playback_volume',
  'sandbox_audiophile_enabled',
  'sandbox_audiophile_device_id',
  'sandbox_audiophile_exclusive',
  'sandbox_android_native_playback',
  'sandbox_android_native_playback_experimental',
  'sandbox_android_webview_crossfade',
  'sandbox_sleep_timer',
  'sandbox_wake_alarm',
  'sandbox_car_mode_enabled',
  'sandbox_car_mode_auto_offer',
  'sandbox_car_mode_offer_dismissed',
  'sandbox_air_gap_mode',
  'sandbox_play_queue_state_v1',
  'sandbox_last_queue',
  'sandbox_vinyl_visual_settings_v1',
  'sandbox_hero_display',
  'sandbox_onboarding_complete',
  'sandbox_onboarding_taste_seeds_v1',
  'sandbox_server_setup_complete_v1',
  'sandbox_tauri_cast_guidance_dismissed',
  'sandbox_tauri_cast_guidance_requested',
  'sandbox_locker_root',
  'sandbox_server_mode',
  'sandbox_server_remote_url',
  'sandbox_server_download_to_locker',
  'sandbox_server_auto_start',
  'sandbox_device_secret_sync_enabled',
  'sandbox_taste_profile_v1',
  'sandbox_liked_envelopes_v1',
  'sandbox_layer4_playlists',
] as const;

export type PersistedPrefKey = (typeof PERSISTED_PREF_KEYS)[number];

function prefStore(): Storage {
  const { dataPersistence } = loadSecuritySettings();
  return dataPersistence ? localStorage : sessionStorage;
}

function otherStore(primary: Storage): Storage {
  return primary === localStorage ? sessionStorage : localStorage;
}

export function prefsGetItem(key: string): string | null {
  try {
    const primary = prefStore();
    const v = primary.getItem(key);
    if (v !== null) return v;
    return otherStore(primary).getItem(key);
  } catch {
    return null;
  }
}

export function prefsSetItem(key: string, value: string): boolean {
  const primary = prefStore();
  const secondary = otherStore(primary);
  try {
    primary.setItem(key, value);
    try {
      secondary.removeItem(key);
    } catch {
      /* ignore secondary cleanup failure */
    }
    return true;
  } catch (err) {
    console.warn('[Sandbox] prefsSetItem failed:', key, err);
    return false;
  }
}

export function prefsRemoveItem(key: string): void {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

/** Migrate prefs between stores when Data Persistence toggles. */
export function migratePrefsOnPersistenceChange(enabled: boolean): void {
  const to = enabled ? localStorage : sessionStorage;
  const from = enabled ? sessionStorage : localStorage;
  for (const key of PERSISTED_PREF_KEYS) {
    const v = from.getItem(key);
    if (v !== null) {
      to.setItem(key, v);
      from.removeItem(key);
    }
  }
}
