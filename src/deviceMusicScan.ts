/**
 * Android MediaStore music scan — read-only device library discovery for Locker upload.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { DeviceMusicScanHit } from './lockerUploadFilter';

export type DeviceMusicScanProgress = {
  scanned?: number;
  matched?: number;
};

export interface DeviceMusicScanPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ granted: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  scan(): Promise<{ tracks: DeviceMusicScanHit[]; count: number }>;
  /** Read-only MediaStore scan for Books/Audiobooks — never mutates files. */
  scanAudiobooks(): Promise<{ tracks: DeviceMusicScanHit[]; count: number }>;
  addListener(
    eventName: 'scanProgress',
    listenerFunc: (event: DeviceMusicScanProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const DeviceMusicScan = registerPlugin<DeviceMusicScanPlugin>('DeviceMusicScan', {
  web: () => import('./deviceMusicScan.web').then((m) => new m.DeviceMusicScanWeb()),
});

export function isDeviceMusicScanAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function checkDeviceMusicScanPermission(): Promise<boolean> {
  if (!isDeviceMusicScanAvailable()) return false;
  try {
    const result = await DeviceMusicScan.checkPermissions();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export async function requestDeviceMusicScanPermission(): Promise<boolean> {
  if (!isDeviceMusicScanAvailable()) return false;
  try {
    const result = await DeviceMusicScan.requestPermissions();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export async function scanDeviceMusic(
  onProgress?: (progress: DeviceMusicScanProgress) => void,
): Promise<DeviceMusicScanHit[]> {
  if (!isDeviceMusicScanAvailable()) return [];

  let handle: PluginListenerHandle | undefined;
  if (onProgress) {
    handle = await DeviceMusicScan.addListener('scanProgress', onProgress);
  }

  try {
    // scan() requests permission on native side and resumes via scanPermsCallback.
    const result = await DeviceMusicScan.scan();
    return result.tracks ?? [];
  } finally {
    await handle?.remove();
  }
}

/** Read-only audiobook MediaStore scan — never imports into music locker or podcasts. */
export async function scanDeviceAudiobooks(
  onProgress?: (progress: DeviceMusicScanProgress) => void,
): Promise<DeviceMusicScanHit[]> {
  if (!isDeviceMusicScanAvailable()) return [];

  let handle: PluginListenerHandle | undefined;
  if (onProgress) {
    handle = await DeviceMusicScan.addListener('scanProgress', onProgress);
  }

  try {
    const result = await DeviceMusicScan.scanAudiobooks();
    return result.tracks ?? [];
  } finally {
    await handle?.remove();
  }
}
