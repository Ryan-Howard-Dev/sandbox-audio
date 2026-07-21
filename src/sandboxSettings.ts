/**
 * Sandbox playback / fidelity / orchestrator settings (persisted via prefsStorage).
 */

import { firstRunGetItem, firstRunRemoveItem, firstRunSetItem } from './firstRunStorage';
import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';
import { getCastRuntime } from './castPlatform';
import { isWifiNetwork } from './networkPlayPolicy';
import { isAndroid, isCapacitorNative, isTauri } from './platformEnv';
import { loadAndroidNativePlaybackEnabled } from './androidNativePlaybackSettings';
import { isNativeCapacitorNonTv, usesMobileShellLayout } from './hooks/mobileShellLayout';
import type { ConnectRolePref } from './tier34/connectProtocol';
import type { SonicPeqPresetId } from './sonicPeqPresets';
import { normalizeSonicPeqPresetId } from './sonicPeqPresets';
import {
  DEFAULT_DEVICE_CAPACITY,
  DEVICE_CAPACITY_OPTIONS,
  type DeviceCapacity,
} from './stations/theme';

export type FidelityPolicy = 'STANDARD' | 'HIGH' | 'LOSSLESS';

const FIDELITY_KEY = 'sandbox_fidelity_policy';
const CASTING_KEY = 'sandbox_is_casting';
const GAPLESS_KEY = 'sandbox_gapless';
const CROSSFADE_KEY = 'sandbox_crossfade';
const CAPACITY_KEY = 'sandbox_device_capacity';
const NETWORK_KEY = 'sandbox_network_sync';
const CONNECT_ROLE_KEY = 'sandbox_connect_role';
const CONNECT_DEVICE_ID_KEY = 'sandbox_connect_device_id';
const CONNECT_DEVICE_NAME_KEY = 'sandbox_connect_device_name';
const CONNECT_SETUP_DONE_KEY = 'sandbox_connect_setup_done';
const STREAM_CACHE_KEY = 'sandbox_stream_cache_enabled';
const STREAM_CACHE_LIMIT_KEY = 'sandbox_stream_cache_limit_mb';
const AGGRESSIVE_CACHE_KEY = 'sandbox_aggressive_offline_cache';
const AGGRESSIVE_CACHE_MAX_MB_KEY = 'sandbox_aggressive_cache_max_mb';
/** One-time marker — stream cache smart defaults applied for this install. */
const AUTO_CACHE_DEFAULTS_MIGRATION_KEY = 'sandbox_auto_cache_defaults_v1';
const AUDIO_PHILE_KEY = 'sandbox_audiophile_enabled';
const AUDIO_PHILE_DEVICE_KEY = 'sandbox_audiophile_device_id';
const AUDIO_PHILE_EXCLUSIVE_KEY = 'sandbox_audiophile_exclusive';
const SANDBOX_SONIC_ENABLED_KEY = 'sandbox_sonic_enabled';
const SANDBOX_SONIC_EAR_SAFE_KEY = 'sandbox_sonic_ear_safe';
const SANDBOX_SONIC_OUTPUT_OVERRIDE_KEY = 'sandbox_sonic_output_override_v1';
const SANDBOX_SPATIAL_ENABLED_KEY = 'sandbox_spatial_enabled_v1';
const SANDBOX_SPATIAL_WIDTH_KEY = 'sandbox_spatial_width_v1';
const SONIC_PEQ_PRESET_KEY = 'sandbox_sonic_peq_preset_v1';

/** Manual output tuning when auto route detection is unreliable (desktop / Linux). */
export type SonicOutputOverride = 'auto' | 'speaker' | 'headphones' | 'line-out';
const EXPERIMENTAL_INTEGRATIONS_KEY = 'sandbox_show_experimental_integrations';

export const STREAM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Persisted URI resolution cache TTL (mobile / server hybrid pipeline). */
export const MOBILE_RESOLUTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_STREAM_CACHE_LIMIT_MB = 500;
export const STREAM_CACHE_LIMIT_OPTIONS = [100, 250, 500, 1000, 2000] as const;
export type StreamCacheLimitMb = (typeof STREAM_CACHE_LIMIT_OPTIONS)[number];

export const DEFAULT_AGGRESSIVE_CACHE_MAX_MB = 100;
export const AGGRESSIVE_CACHE_MAX_OPTIONS = [50, 100, 150, 200, 500] as const;
export type AggressiveCacheMaxMb = (typeof AGGRESSIVE_CACHE_MAX_OPTIONS)[number];

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

export function loadFidelityPolicy(): FidelityPolicy {
  const v = prefsGetItem(FIDELITY_KEY) ?? 'LOSSLESS';
  if (v === 'STANDARD' || v === 'HIGH' || v === 'LOSSLESS') return v;
  return 'LOSSLESS';
}

export function saveFidelityPolicy(policy: FidelityPolicy): void {
  prefsSetItem(FIDELITY_KEY, policy);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadCastingEnabled(): boolean {
  return loadBool(CASTING_KEY, false);
}

export function saveCastingEnabled(enabled: boolean): void {
  prefsSetItem(CASTING_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadGaplessEnabled(): boolean {
  return loadBool(GAPLESS_KEY, true);
}

export function saveGaplessEnabled(enabled: boolean): void {
  prefsSetItem(GAPLESS_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadCrossfadeEnabled(): boolean {
  return loadBool(CROSSFADE_KEY, false);
}

export function saveCrossfadeEnabled(enabled: boolean): void {
  prefsSetItem(CROSSFADE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadNetworkSyncEnabled(): boolean {
  return loadBool(NETWORK_KEY, true);
}

export function saveNetworkSyncEnabled(enabled: boolean): void {
  prefsSetItem(NETWORK_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadConnectRolePref(): ConnectRolePref {
  const v = prefsGetItem(CONNECT_ROLE_KEY);
  if (v === 'host' || v === 'remote' || v === 'auto') return v;
  return 'auto';
}

export function saveConnectRolePref(role: ConnectRolePref): void {
  prefsSetItem(CONNECT_ROLE_KEY, role);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Resolve auto → host everywhere (local playback). Explicit 'remote' still targets Connect host. */
export function resolveConnectRole(pref?: ConnectRolePref): 'host' | 'remote' {
  const p = pref ?? loadConnectRolePref();
  if (p === 'host') return 'host';
  if (p === 'remote') return 'remote';
  return 'host';
}

/** One-time per launch: phones play locally unless user completed Connect remote setup. */
export function ensureAndroidLocalPlaybackOnLaunch(): void {
  if (getCastRuntime() !== 'capacitor-android') return;
  const pref = loadConnectRolePref();
  if (pref === 'remote' && !loadConnectSetupDone()) {
    saveConnectRolePref('host');
  }
}

export function getOrCreateConnectDeviceId(): string {
  let id = prefsGetItem(CONNECT_DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    prefsSetItem(CONNECT_DEVICE_ID_KEY, id);
  }
  return id;
}

export function loadConnectDeviceName(): string {
  const saved = prefsGetItem(CONNECT_DEVICE_NAME_KEY);
  if (saved?.trim()) return saved.trim();
  if (typeof navigator !== 'undefined') {
    const platform = navigator.platform?.trim() || 'Device';
    return `${platform} ${resolveConnectRole()}`;
  }
  return 'Sovereign Device';
}

export function saveConnectDeviceName(name: string): void {
  prefsSetItem(CONNECT_DEVICE_NAME_KEY, name.trim());
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadConnectSetupDone(): boolean {
  return loadBool(CONNECT_SETUP_DONE_KEY, false);
}

export function saveConnectSetupDone(done: boolean): void {
  prefsSetItem(CONNECT_SETUP_DONE_KEY, String(done));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadDeviceCapacity(): DeviceCapacity {
  const saved = prefsGetItem(CAPACITY_KEY);
  if (saved && (DEVICE_CAPACITY_OPTIONS as readonly string[]).includes(saved)) {
    return saved as DeviceCapacity;
  }
  return DEFAULT_DEVICE_CAPACITY;
}

export function saveDeviceCapacity(capacity: DeviceCapacity): void {
  prefsSetItem(CAPACITY_KEY, capacity);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadStreamCacheEnabled(): boolean {
  return loadBool(STREAM_CACHE_KEY, true);
}

export function saveStreamCacheEnabled(enabled: boolean): void {
  prefsSetItem(STREAM_CACHE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadStreamCacheLimitMb(): StreamCacheLimitMb {
  const v = prefsGetItem(STREAM_CACHE_LIMIT_KEY);
  const n = v ? parseInt(v, 10) : DEFAULT_STREAM_CACHE_LIMIT_MB;
  if ((STREAM_CACHE_LIMIT_OPTIONS as readonly number[]).includes(n)) {
    return n as StreamCacheLimitMb;
  }
  return DEFAULT_STREAM_CACHE_LIMIT_MB;
}

export function saveStreamCacheLimitMb(mb: StreamCacheLimitMb): void {
  prefsSetItem(STREAM_CACHE_LIMIT_KEY, String(mb));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** User explicitly chose aggressive offline cache (vs smart Wi‑Fi default). */
export function hasExplicitAggressiveOfflineCachePref(): boolean {
  const v = prefsGetItem(AGGRESSIVE_CACHE_KEY);
  return v === 'true' || v === 'false';
}

/**
 * Prefetch entire remote track into IndexedDB before playback.
 * When unset: on by default on Wi‑Fi / unmetered (Tidal-like); off on cellular.
 */
export function loadAggressiveOfflineCacheEnabled(): boolean {
  const v = prefsGetItem(AGGRESSIVE_CACHE_KEY);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return isWifiNetwork();
}

/** First boot — stream cache stays on; aggressive follows network unless user opts out later. */
export function ensureStreamCacheSmartDefaults(): void {
  if (firstRunGetItem(AUTO_CACHE_DEFAULTS_MIGRATION_KEY) === '1') return;
  firstRunSetItem(AUTO_CACHE_DEFAULTS_MIGRATION_KEY, '1');
  if (prefsGetItem(STREAM_CACHE_KEY) == null) {
    saveStreamCacheEnabled(true);
  }
}

export function saveAggressiveOfflineCacheEnabled(enabled: boolean): void {
  prefsSetItem(AGGRESSIVE_CACHE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadAggressiveCacheMaxMb(): AggressiveCacheMaxMb {
  const v = prefsGetItem(AGGRESSIVE_CACHE_MAX_MB_KEY);
  const n = v ? parseInt(v, 10) : DEFAULT_AGGRESSIVE_CACHE_MAX_MB;
  if ((AGGRESSIVE_CACHE_MAX_OPTIONS as readonly number[]).includes(n)) {
    return n as AggressiveCacheMaxMb;
  }
  return DEFAULT_AGGRESSIVE_CACHE_MAX_MB;
}

export function saveAggressiveCacheMaxMb(mb: AggressiveCacheMaxMb): void {
  prefsSetItem(AGGRESSIVE_CACHE_MAX_MB_KEY, String(mb));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export const CROSSFADE_DURATION_SEC = 2.5;

const PLAYBACK_VOLUME_KEY = 'sandbox_playback_volume';

/** Max in-app volume — Android native path can software-boost above system max (200% ≈ +6 dB). */
export const ANDROID_PLAYBACK_VOLUME_CAP = 2.0;

export function getPlaybackVolumeCap(): number {
  if (isAndroid() && loadAndroidNativePlaybackEnabled()) return ANDROID_PLAYBACK_VOLUME_CAP;
  return 1.0;
}

export function loadPlaybackVolume(): number {
  const v = prefsGetItem(PLAYBACK_VOLUME_KEY);
  const cap = getPlaybackVolumeCap();
  if (v === null) return Math.min(1.0, cap);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return Math.min(1.0, cap);
  return Math.max(0, Math.min(cap, n));
}

export function savePlaybackVolume(level: number): void {
  const clamped = Math.max(0, Math.min(getPlaybackVolumeCap(), level));
  prefsSetItem(PLAYBACK_VOLUME_KEY, String(clamped));
}

export function loadAudiophileEnabled(): boolean {
  return loadBool(AUDIO_PHILE_KEY, false);
}

export function saveAudiophileEnabled(enabled: boolean): void {
  prefsSetItem(AUDIO_PHILE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadAudiophileDeviceId(): string | null {
  return prefsGetItem(AUDIO_PHILE_DEVICE_KEY);
}

export function saveAudiophileDeviceId(deviceId: string | null): void {
  if (deviceId) prefsSetItem(AUDIO_PHILE_DEVICE_KEY, deviceId);
  else prefsRemoveItem(AUDIO_PHILE_DEVICE_KEY);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadAudiophileExclusiveMode(): boolean {
  return loadBool(AUDIO_PHILE_EXCLUSIVE_KEY, true);
}

export function saveAudiophileExclusiveMode(enabled: boolean): void {
  prefsSetItem(AUDIO_PHILE_EXCLUSIVE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Sandbox Sonic — on-device EQ, limiter, and ear-safe listening (Web Audio path). */
export function loadSandboxSonicEnabled(): boolean {
  return loadBool(SANDBOX_SONIC_ENABLED_KEY, true);
}

export function saveSandboxSonicEnabled(enabled: boolean): void {
  prefsSetItem(SANDBOX_SONIC_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadEarSafeListeningEnabled(): boolean {
  return loadBool(SANDBOX_SONIC_EAR_SAFE_KEY, true);
}

export function saveEarSafeListeningEnabled(enabled: boolean): void {
  prefsSetItem(SANDBOX_SONIC_EAR_SAFE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadSonicOutputOverride(): SonicOutputOverride {
  const v = prefsGetItem(SANDBOX_SONIC_OUTPUT_OVERRIDE_KEY);
  if (v === 'speaker' || v === 'headphones' || v === 'line-out') return v;
  return 'auto';
}

export function saveSonicOutputOverride(override: SonicOutputOverride): void {
  prefsSetItem(SANDBOX_SONIC_OUTPUT_OVERRIDE_KEY, override);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Sandbox Spatial — headphone stereo widener in Web Audio Sonic chain. */
export function loadSandboxSpatialEnabled(): boolean {
  return loadBool(SANDBOX_SPATIAL_ENABLED_KEY, false);
}

export function saveSandboxSpatialEnabled(enabled: boolean): void {
  prefsSetItem(SANDBOX_SPATIAL_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Spatial width 0–1 (stored as 0–100 integer). */
export function loadSandboxSpatialWidth(): number {
  const raw = prefsGetItem(SANDBOX_SPATIAL_WIDTH_KEY);
  const n = raw != null ? Number(raw) : 60;
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n / 100));
}

export function saveSandboxSpatialWidth(width01: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, width01)) * 100);
  prefsSetItem(SANDBOX_SPATIAL_WIDTH_KEY, String(pct));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadSonicPeqPresetId(): SonicPeqPresetId {
  return normalizeSonicPeqPresetId(prefsGetItem(SONIC_PEQ_PRESET_KEY));
}

export function saveSonicPeqPresetId(presetId: SonicPeqPresetId): void {
  prefsSetItem(SONIC_PEQ_PRESET_KEY, presetId);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Show built-in stub addons (SoundCloud, WebTorrent, IPFS) in Settings and search. Off by default. */
export function loadShowExperimentalIntegrations(): boolean {
  return loadBool(EXPERIMENTAL_INTEGRATIONS_KEY, false);
}

export function saveShowExperimentalIntegrations(enabled: boolean): void {
  prefsSetItem(EXPERIMENTAL_INTEGRATIONS_KEY, String(enabled));
  void import('./addonStorage').then(({ syncExperimentalAddons }) => {
    syncExperimentalAddons(enabled);
  });
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** Embedded Sandbox Server — mode, remote URL, and local server preferences. */
export type SandboxServerMode = 'off' | 'remote' | 'anchor';

export const SANDBOX_SERVER_ANCHOR_URL = 'http://127.0.0.1:3001';
export const DEFAULT_SANDBOX_SERVER_REMOTE_URL = 'http://192.168.1.1:3001';

const SERVER_MODE_KEY = 'sandbox_server_mode';
const SERVER_REMOTE_URL_KEY = 'sandbox_server_remote_url';
const SERVER_DOWNLOAD_TO_LOCKER_KEY = 'sandbox_server_download_to_locker';
const SERVER_AUTO_START_KEY = 'sandbox_server_auto_start';
const SERVER_SETUP_COMPLETE_KEY = 'sandbox_server_setup_complete_v1';
const TIER34_BACKEND_KEY = 'sandbox_tier34_backend_url';
const DESKTOP_ANCHOR_MIGRATION_KEY = 'sandbox_desktop_anchor_v1';

/** Keep sandbox_tier34_backend_url aligned with vault server mode / remote URL. */
export function syncTier34BackendUrlFromServerMode(): string | null {
  const mode = loadSandboxServerMode();
  if (mode === 'anchor') {
    prefsSetItem(TIER34_BACKEND_KEY, SANDBOX_SERVER_ANCHOR_URL);
    return SANDBOX_SERVER_ANCHOR_URL;
  }
  if (mode === 'remote') {
    const remote = loadSandboxServerRemoteUrl().trim();
    if (remote) {
      prefsSetItem(TIER34_BACKEND_KEY, remote);
      return remote;
    }
  }
  if (mode === 'off') {
    prefsRemoveItem(TIER34_BACKEND_KEY);
    return null;
  }
  return null;
}

export function loadSandboxServerMode(): SandboxServerMode {
  const v = prefsGetItem(SERVER_MODE_KEY);
  if (v === 'off' || v === 'remote' || v === 'anchor') return v;
  if (isTauri()) return 'anchor';
  return 'off';
}

/** First-run desktop defaults — anchor mode + backend URL without manual setup. */
export function ensureDesktopSandboxDefaults(): void {
  if (!isTauri()) return;
  if (prefsGetItem(SERVER_MODE_KEY) == null) {
    saveSandboxServerMode('anchor');
    return;
  }
  if (
    prefsGetItem(DESKTOP_ANCHOR_MIGRATION_KEY) !== '1' &&
    loadSandboxServerMode() === 'off' &&
    !loadSandboxServerRemoteUrl().trim()
  ) {
    prefsSetItem(DESKTOP_ANCHOR_MIGRATION_KEY, '1');
    saveSandboxServerMode('anchor');
    return;
  }
  syncTier34BackendUrlFromServerMode();
}

export function saveSandboxServerMode(mode: SandboxServerMode): void {
  prefsSetItem(SERVER_MODE_KEY, mode);
  syncTier34BackendUrlFromServerMode();
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadSandboxServerRemoteUrl(): string {
  return prefsGetItem(SERVER_REMOTE_URL_KEY)?.trim() || '';
}

export function saveSandboxServerRemoteUrl(url: string): void {
  prefsSetItem(SERVER_REMOTE_URL_KEY, url.trim());
  if (loadSandboxServerMode() === 'remote') {
    syncTier34BackendUrlFromServerMode();
  }
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadSandboxServerDownloadToLocker(): boolean {
  return loadBool(SERVER_DOWNLOAD_TO_LOCKER_KEY, false);
}

export function saveSandboxServerDownloadToLocker(enabled: boolean): void {
  prefsSetItem(SERVER_DOWNLOAD_TO_LOCKER_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadSandboxServerAutoStart(): boolean {
  const stored = prefsGetItem(SERVER_AUTO_START_KEY);
  if (stored != null) return loadBool(SERVER_AUTO_START_KEY, false);
  return loadSandboxServerMode() === 'anchor';
}

export function saveSandboxServerAutoStart(enabled: boolean): void {
  prefsSetItem(SERVER_AUTO_START_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

function loadFirstRunBool(key: string, fallback: boolean): boolean {
  const v = firstRunGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

function saveFirstRunBool(key: string, value: boolean): void {
  firstRunSetItem(key, String(value));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadServerSetupComplete(): boolean {
  return loadFirstRunBool(SERVER_SETUP_COMPLETE_KEY, false);
}

export function saveServerSetupComplete(complete: boolean): void {
  saveFirstRunBool(SERVER_SETUP_COMPLETE_KEY, complete);
}

/** Mobile / client — show dedicated server setup when no URL configured after onboarding. */
export function shouldShowServerSetup(): boolean {
  if (!isCapacitorNative()) return false;
  if (loadServerSetupComplete()) return false;
  const mode = loadSandboxServerMode();
  if (mode === 'anchor') return false;
  if (mode === 'remote' && loadSandboxServerRemoteUrl().trim()) return false;
  return true;
}

/** Optional on-disk locker root (desktop import/export, server sync). Empty = default app storage. */
const LOCKER_ROOT_KEY = 'sandbox_locker_root';

export function loadLockerRootPath(): string {
  return prefsGetItem(LOCKER_ROOT_KEY)?.trim() || '';
}

export function saveLockerRootPath(path: string): void {
  const trimmed = path.trim();
  if (trimmed) prefsSetItem(LOCKER_ROOT_KEY, trimmed);
  else prefsRemoveItem(LOCKER_ROOT_KEY);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** First-run onboarding wizard — complete flag and taste seeds for Discover/Feed. */
const ONBOARDING_COMPLETE_KEY = 'sandbox_onboarding_complete';
const ONBOARDING_TASTE_SEEDS_KEY = 'sandbox_onboarding_taste_seeds_v1';

export type OnboardingTasteSeeds = {
  genres: string[];
  artistsFreeText?: string;
};

export function loadOnboardingComplete(): boolean {
  return loadFirstRunBool(ONBOARDING_COMPLETE_KEY, false);
}

export function saveOnboardingComplete(complete: boolean): void {
  saveFirstRunBool(ONBOARDING_COMPLETE_KEY, complete);
}

/** Dev/testing — clears onboarding flag and stored taste seeds. */
export function resetOnboardingForTesting(): void {
  firstRunRemoveItem(ONBOARDING_COMPLETE_KEY);
  prefsRemoveItem(ONBOARDING_COMPLETE_KEY);
  prefsRemoveItem(ONBOARDING_TASTE_SEEDS_KEY);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadOnboardingTasteSeeds(): OnboardingTasteSeeds | null {
  const raw = prefsGetItem(ONBOARDING_TASTE_SEEDS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingTasteSeeds>;
    if (!parsed || !Array.isArray(parsed.genres)) return null;
    return {
      genres: parsed.genres.filter((g): g is string => typeof g === 'string'),
      artistsFreeText:
        typeof parsed.artistsFreeText === 'string' ? parsed.artistsFreeText : undefined,
    };
  } catch {
    return null;
  }
}

export function saveOnboardingTasteSeeds(seeds: OnboardingTasteSeeds): void {
  prefsSetItem(ONBOARDING_TASTE_SEEDS_KEY, JSON.stringify(seeds));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

const TAURI_CAST_GUIDANCE_DISMISSED_KEY = 'sandbox_tauri_cast_guidance_dismissed';
const TAURI_CAST_GUIDANCE_REQUESTED_KEY = 'sandbox_tauri_cast_guidance_requested';
const TV_COVERAGE_BANNER_DISMISSED_KEY = 'sandbox_tv_coverage_banner_dismissed';

export function loadTauriCastGuidanceDismissed(): boolean {
  return loadBool(TAURI_CAST_GUIDANCE_DISMISSED_KEY, false);
}

export function saveTauriCastGuidanceDismissed(dismissed: boolean): void {
  prefsSetItem(TAURI_CAST_GUIDANCE_DISMISSED_KEY, String(dismissed));
}

export function loadTauriCastGuidanceRequested(): boolean {
  return loadBool(TAURI_CAST_GUIDANCE_REQUESTED_KEY, false);
}

/** User opened Cast from the player or Settings — enables one-time contextual guidance. */
export function requestTauriCastGuidance(): void {
  if (loadTauriCastGuidanceRequested()) return;
  prefsSetItem(TAURI_CAST_GUIDANCE_REQUESTED_KEY, 'true');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

export function shouldShowTauriCastGuidancePanel(): boolean {
  return !loadTauriCastGuidanceDismissed();
}

export function loadTvCoverageBannerDismissed(): boolean {
  return loadBool(TV_COVERAGE_BANNER_DISMISSED_KEY, false);
}

export function saveTvCoverageBannerDismissed(dismissed: boolean): void {
  prefsSetItem(TV_COVERAGE_BANNER_DISMISSED_KEY, String(dismissed));
}

/**
 * First launch — Tauri desktop, native phone/tablet APK (incl. sw600dp tablets on desktop shell),
 * PWA ≤767px, or dev `?mobile=1`.
 */
export function shouldShowOnboardingWizard(): boolean {
  if (loadOnboardingComplete()) return false;
  if (isTauri()) return true;
  // Phones and tablets — not leanback TV. Tablets use desktop shell but still need first-run guide.
  if (isNativeCapacitorNonTv()) return true;
  if (isCapacitorNative()) return true;
  return usesMobileShellLayout();
}
