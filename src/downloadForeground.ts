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

export async function syncDownloadForegroundState(options: {
  active: boolean;
  title?: string;
  completedTracks?: number;
  totalTracks?: number;
  queueCount?: number;
}): Promise<void> {
  if (!isDownloadForegroundAvailable()) return;

  if (!options.active) {
    lastPayload = null;
    await DownloadForeground.stop().catch(() => {});
    return;
  }

  const payload = {
    title: options.title ?? '',
    completedTracks: options.completedTracks ?? 0,
    totalTracks: options.totalTracks ?? 0,
    queueCount: options.queueCount ?? 0,
  };
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
}

export async function refreshDownloadForegroundIfActive(): Promise<void> {
  if (!lastPayload || !isDownloadForegroundAvailable()) return;
  await syncDownloadForegroundState({ active: true, ...lastPayload });
}
