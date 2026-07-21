import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const PODCASTS_ENABLED_KEY = 'sandbox_podcasts_enabled';
export const PODCAST_PLAYBACK_SPEED_KEY = 'sandbox_podcast_playback_speed';
export const PODCAST_SEEK_INTERVAL_KEY = 'sandbox_podcast_seek_interval_sec';
export const PODCAST_NOTIF_ENABLED_KEY = 'sandbox_podcast_notif_enabled';
export const PODCAST_AUTO_DOWNLOAD_WIFI_KEY = 'sandbox_podcast_auto_download_wifi_only';
export const PODCAST_SMART_SPEED_KEY = 'sandbox_podcast_smart_speed_enabled';
export const PODCAST_VOICE_BOOST_KEY = 'sandbox_podcast_voice_boost_enabled';
export const PODCAST_SKIP_AD_CHAPTERS_KEY = 'sandbox_podcast_skip_ad_chapters_enabled';
export const PODCAST_MANUAL_AD_SKIP_SECONDS_KEY = 'sandbox_podcast_manual_ad_skip_seconds';

/** One-tap Skip Ad forward jump when chapter markers are missing. */
export const PODCAST_MANUAL_AD_SKIP_OPTIONS = [60, 75, 90] as const;

export const PODCAST_SETTINGS_CHANGE_EVENT = 'sandbox-podcast-settings-change';
/** Deferred audio-chain refresh — avoids global sandbox-settings-change storm. */
export const PODCAST_PLAYBACK_REFRESH_EVENT = 'sandbox-podcast-playback-refresh';

let playbackRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export const PODCAST_PLAYBACK_SPEEDS = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const PODCAST_SEEK_INTERVALS = [15, 30, 45, 60] as const;

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

function loadNumber(key: string, fallback: number): number {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadPodcastsEnabled(): boolean {
  return loadBool(PODCASTS_ENABLED_KEY, false);
}

export function savePodcastsEnabled(enabled: boolean): void {
  prefsSetItem(PODCASTS_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

function notifyPodcastSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PODCAST_SETTINGS_CHANGE_EVENT));
  if (playbackRefreshTimer != null) clearTimeout(playbackRefreshTimer);
  playbackRefreshTimer = setTimeout(() => {
    playbackRefreshTimer = null;
    window.dispatchEvent(new Event(PODCAST_PLAYBACK_REFRESH_EVENT));
  }, 16);
}

export function loadPodcastPlaybackSpeed(): number {
  const raw = loadNumber(PODCAST_PLAYBACK_SPEED_KEY, 1);
  return PODCAST_PLAYBACK_SPEEDS.includes(raw as (typeof PODCAST_PLAYBACK_SPEEDS)[number])
    ? raw
    : 1;
}

export function savePodcastPlaybackSpeed(speed: number): void {
  prefsSetItem(PODCAST_PLAYBACK_SPEED_KEY, String(speed));
  notifyPodcastSettings();
}

export function cyclePodcastPlaybackSpeed(current = loadPodcastPlaybackSpeed()): number {
  const idx = PODCAST_PLAYBACK_SPEEDS.indexOf(
    current as (typeof PODCAST_PLAYBACK_SPEEDS)[number],
  );
  const next =
    idx < 0
      ? 1
      : PODCAST_PLAYBACK_SPEEDS[(idx + 1) % PODCAST_PLAYBACK_SPEEDS.length];
  savePodcastPlaybackSpeed(next);
  return next;
}

export function loadPodcastSeekIntervalSeconds(): number {
  const raw = loadNumber(PODCAST_SEEK_INTERVAL_KEY, 30);
  return PODCAST_SEEK_INTERVALS.includes(raw as (typeof PODCAST_SEEK_INTERVALS)[number])
    ? raw
    : 30;
}

export function savePodcastSeekIntervalSeconds(seconds: number): void {
  prefsSetItem(PODCAST_SEEK_INTERVAL_KEY, String(seconds));
  notifyPodcastSettings();
}

export function loadPodcastNotifEnabled(): boolean {
  return loadBool(PODCAST_NOTIF_ENABLED_KEY, true);
}

export function savePodcastNotifEnabled(enabled: boolean): void {
  prefsSetItem(PODCAST_NOTIF_ENABLED_KEY, String(enabled));
  notifyPodcastSettings();
}

export function loadPodcastAutoDownloadWifiOnly(): boolean {
  return loadBool(PODCAST_AUTO_DOWNLOAD_WIFI_KEY, true);
}

export function savePodcastAutoDownloadWifiOnly(wifiOnly: boolean): void {
  prefsSetItem(PODCAST_AUTO_DOWNLOAD_WIFI_KEY, String(wifiOnly));
  notifyPodcastSettings();
}

export function loadPodcastSmartSpeedEnabled(): boolean {
  return loadBool(PODCAST_SMART_SPEED_KEY, false);
}

export function savePodcastSmartSpeedEnabled(enabled: boolean): void {
  prefsSetItem(PODCAST_SMART_SPEED_KEY, String(enabled));
  notifyPodcastSettings();
}

export function loadPodcastVoiceBoostEnabled(): boolean {
  return loadBool(PODCAST_VOICE_BOOST_KEY, false);
}

export function savePodcastVoiceBoostEnabled(enabled: boolean): void {
  prefsSetItem(PODCAST_VOICE_BOOST_KEY, String(enabled));
  notifyPodcastSettings();
}

export function loadPodcastSkipAdChaptersEnabled(): boolean {
  return loadBool(PODCAST_SKIP_AD_CHAPTERS_KEY, false);
}

export function savePodcastSkipAdChaptersEnabled(enabled: boolean): void {
  prefsSetItem(PODCAST_SKIP_AD_CHAPTERS_KEY, String(enabled));
  notifyPodcastSettings();
}

export function loadPodcastManualAdSkipSeconds(): number {
  const raw = loadNumber(PODCAST_MANUAL_AD_SKIP_SECONDS_KEY, 75);
  return PODCAST_MANUAL_AD_SKIP_OPTIONS.includes(
    raw as (typeof PODCAST_MANUAL_AD_SKIP_OPTIONS)[number],
  )
    ? raw
    : 75;
}

export function savePodcastManualAdSkipSeconds(seconds: number): void {
  const clamped = PODCAST_MANUAL_AD_SKIP_OPTIONS.includes(
    seconds as (typeof PODCAST_MANUAL_AD_SKIP_OPTIONS)[number],
  )
    ? seconds
    : 75;
  prefsSetItem(PODCAST_MANUAL_AD_SKIP_SECONDS_KEY, String(clamped));
  notifyPodcastSettings();
}

export function cyclePodcastManualAdSkipSeconds(
  current = loadPodcastManualAdSkipSeconds(),
): number {
  const idx = PODCAST_MANUAL_AD_SKIP_OPTIONS.indexOf(
    current as (typeof PODCAST_MANUAL_AD_SKIP_OPTIONS)[number],
  );
  const next =
    idx < 0
      ? 75
      : PODCAST_MANUAL_AD_SKIP_OPTIONS[(idx + 1) % PODCAST_MANUAL_AD_SKIP_OPTIONS.length];
  savePodcastManualAdSkipSeconds(next);
  return next;
}

export function formatPodcastPlaybackSpeed(speed: number): string {
  return speed === 1 ? '1×' : `${speed}×`;
}
