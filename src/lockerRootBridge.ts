/**
 * Pick and persist an on-disk locker root folder (desktop/Tauri).
 */

import { Capacitor } from '@capacitor/core';
import { isCapacitorNative, isTauri } from './platformEnv';
import { loadLockerRootPath, saveLockerRootPath } from './sandboxSettings';

export type LockerRootPlatform = 'tauri' | 'android' | 'ios' | 'web';

export function getLockerRootPlatform(): LockerRootPlatform {
  if (isTauri()) return 'tauri';
  if (isCapacitorNative()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') return 'android';
    if (platform === 'ios') return 'ios';
  }
  return 'web';
}

/** Native folder picker — desktop/Tauri only. Mobile uses private app storage (IndexedDB). */
export function supportsLockerFolderPicker(): boolean {
  return isTauri();
}

export function usesAutomaticLockerStorage(): boolean {
  const platform = getLockerRootPlatform();
  return platform === 'android' || platform === 'ios';
}

const LOCKER_FOLDER_NAME = 'Sandbox Music';

/** Best-effort default locker folder on desktop (Documents/Sandbox Music). */
export async function suggestLockerRootPath(): Promise<string> {
  if (!isTauri()) return '';
  try {
    const { documentDir, join } = await import('@tauri-apps/api/path');
    return await join(await documentDir(), LOCKER_FOLDER_NAME);
  } catch {
    return '';
  }
}

/** Open a native folder picker on Tauri; returns chosen path or null when cancelled. */
export async function pickLockerRootFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const initialPath = defaultPath?.trim() || (await suggestLockerRootPath());
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose music storage folder',
      ...(initialPath ? { defaultPath: initialPath } : {}),
    });
    if (typeof selected === 'string' && selected.trim()) return selected.trim();
    return null;
  } catch {
    return null;
  }
}

export function persistLockerRootPath(path: string): void {
  saveLockerRootPath(path);
}

export function currentLockerRootPath(): string {
  return loadLockerRootPath();
}
