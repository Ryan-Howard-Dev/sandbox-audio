/**
 * Android download foreground service — keeps acquisition alive while backgrounded.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isAndroid } from './platformEnv';

export interface DownloadForegroundPlugin {
  setActive(options: {
    active: boolean;
    title?: string;
    completedTracks?: number;
    totalTracks?: number;
    queueCount?: number;
  }): Promise<void>;
  updateProgress(options: {
    title?: string;
    completedTracks?: number;
    totalTracks?: number;
    queueCount?: number;
  }): Promise<void>;
  stop(): Promise<void>;
  isActive(): Promise<{ active: boolean }>;
}

const DownloadForeground = registerPlugin<DownloadForegroundPlugin>('DownloadForeground', {
  web: () => import('./downloadForeground.web').then((m) => new m.DownloadForegroundWeb()),
});

export function isDownloadForegroundAvailable(): boolean {
  return Capacitor.isNativePlatform() && isAndroid();
}

let lastPayload: {
  title: string;
  completedTracks: number;
  totalTracks: number;
  queueCount: number;
} | null = null;

/**
 * Guards against a runaway bridge flood. This is driven by download-queue change events,
 * which can fire in tight bursts (and can oscillate between "no active jobs" and "active
 * jobs"). Each sync costs 2-3 Capacitor round-trips, so an unguarded burst can pile up
 * millions of calls and wedge the WebView's main thread — the UI freezes even though
 * native audio keeps playing. `syncKey` collapses no-op repeats; `inFlight` serializes
 * overlapping syncs so a burst can never fan out into concurrent bridge chains.
 */
let lastSyncKey = '';
let inFlight: Promise<void> | null = null;

function payloadSyncKey(
  active: boolean,
  payload: { title: string; completedTracks: number; totalTracks: number; queueCount: number } | null,
): string {
  if (!active || !payload) return 'inactive';
  return `active|${payload.title}|${payload.completedTracks}|${payload.totalTracks}|${payload.queueCount}`;
}

export async function syncDownloadForegroundState(options: {
  active: boolean;
  title?: string;
  completedTracks?: number;
  totalTracks?: number;
  queueCount?: number;
  /** Re-assert the foreground service even if nothing changed (app backgrounding, keepalive). */
  force?: boolean;
}): Promise<void> {
  if (!isDownloadForegroundAvailable()) return;

  const payload = options.active
    ? {
        title: options.title ?? '',
        completedTracks: options.completedTracks ?? 0,
        totalTracks: options.totalTracks ?? 0,
        queueCount: options.queueCount ?? 0,
      }
    : null;

  const syncKey = payloadSyncKey(options.active, payload);
  const force = options.force === true;
  if (!force && syncKey === lastSyncKey) return;

  if (inFlight) {
    // Coalesce: let the running sync finish, then re-evaluate against the newest state.
    await inFlight.catch(() => {});
    if (!force && syncKey === lastSyncKey) return;
  }

  const run = (async () => {
    if (!payload) {
      lastPayload = null;
      await DownloadForeground.stop().catch(() => {});
      return;
    }
    lastPayload = payload;
    try {
      const status = await DownloadForeground.isActive();
      if (status.active) {
        await DownloadForeground.updateProgress(payload);
      } else {
        await DownloadForeground.setActive({ active: true, ...payload });
      }
    } catch {
      // Native plugin may be unavailable during web dev.
    }
  })();

  lastSyncKey = syncKey;
  inFlight = run.finally(() => {
    inFlight = null;
  });
  await inFlight;
}

export async function refreshDownloadForegroundIfActive(): Promise<void> {
  if (!lastPayload || !isDownloadForegroundAvailable()) return;
  await syncDownloadForegroundState({ active: true, ...lastPayload, force: true });
}
