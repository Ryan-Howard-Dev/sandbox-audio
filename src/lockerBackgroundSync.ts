/**
 * Background locker sync — periodic pull + resume on focus/visibility.
 * Goal: phone picks up PC uploads without manual "Sync now".
 */

import {
  loadLockerSyncSettings,
  LOCKER_SYNC_COMPLETE_EVENT,
  pullAndMergeLockerManifest,
  recordLockerSyncResult,
} from './lockerSync';
import { isBatterySaverEnabled } from './batterySaverSettings';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const BATTERY_SAVER_INTERVAL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let lastPullAt = 0;

export function lockerBackgroundSyncIntervalMs(): number {
  if (isBatterySaverEnabled()) return BATTERY_SAVER_INTERVAL_MS;
  return DEFAULT_INTERVAL_MS;
}

async function runBackgroundPull(reason: string): Promise<void> {
  const settings = loadLockerSyncSettings();
  if (!settings.enabled || settings.backgroundSync === false) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (
    isBatterySaverEnabled() &&
    typeof document !== 'undefined' &&
    document.visibilityState !== 'visible' &&
    reason === 'interval'
  ) {
    return;
  }

  const now = Date.now();
  if (inFlight || now - lastPullAt < MIN_INTERVAL_MS) return;

  inFlight = true;
  lastPullAt = now;
  try {
    const { dispatchLockerSyncStarted } = await import('./lockerSyncProgress');
    dispatchLockerSyncStarted('Background sync…');
    const result = await pullAndMergeLockerManifest();
    if (result.pulled > 0 || result.playlistsImported > 0 || result.playlistsMerged > 0) {
      console.info('[lockerSync] background pull', reason, result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordLockerSyncResult(false, msg);
    console.warn('[lockerSync] background pull failed:', err);
  } finally {
    inFlight = false;
  }
}

/** Start periodic + focus/visibility locker sync. Returns teardown. */
export function initLockerBackgroundSync(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void runBackgroundPull('visibility');
    }
  };
  const onFocus = () => void runBackgroundPull('focus');
  const onOnline = () => void runBackgroundPull('online');
  const onSettings = () => {
    const s = loadLockerSyncSettings();
    if (!s.enabled || s.backgroundSync === false) return;
    void runBackgroundPull('settings-change');
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('sandbox-settings-change', onSettings);

  intervalId = setInterval(() => {
    void runBackgroundPull('interval');
  }, lockerBackgroundSyncIntervalMs());

  void runBackgroundPull('init');

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('sandbox-settings-change', onSettings);
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

export { LOCKER_SYNC_COMPLETE_EVENT };
