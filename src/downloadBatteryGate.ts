/**
 * Pause album downloads on Android when battery is low and device is not charging.
 */

import { isAndroid } from './platformEnv';

export const DOWNLOAD_BATTERY_PAUSE_MESSAGE = 'Paused — charge device';

const LOW_BATTERY_FRACTION = 0.15;

type BatterySnapshot = {
  level: number;
  charging: boolean;
};

type BatteryManager = {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

const listeners = new Set<() => void>();
let batteryManager: BatteryManager | null = null;
let subscribed = false;

async function readBattery(): Promise<BatterySnapshot | null> {
  if (typeof navigator === 'undefined') return null;
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManager>;
    };
    if (!nav.getBattery) return null;
    if (!batteryManager) batteryManager = await nav.getBattery();
    return {
      level: batteryManager.level,
      charging: batteryManager.charging,
    };
  } catch {
    return null;
  }
}

function notifyBatteryListeners(): void {
  listeners.forEach((fn) => fn());
}

function ensureBatterySubscription(): void {
  if (subscribed || !batteryManager) return;
  subscribed = true;
  batteryManager.addEventListener('levelchange', notifyBatteryListeners);
  batteryManager.addEventListener('chargingchange', notifyBatteryListeners);
}

/** True when downloads should pause (Android, low battery, not plugged in). */
export async function shouldPauseDownloadsForBattery(): Promise<boolean> {
  if (!isAndroid()) return false;
  const snap = await readBattery();
  if (!snap) return false;
  ensureBatterySubscription();
  return snap.level < LOW_BATTERY_FRACTION && !snap.charging;
}

export function subscribeDownloadBattery(listener: () => void): () => void {
  listeners.add(listener);
  void readBattery().then(() => ensureBatterySubscription());
  return () => listeners.delete(listener);
}

/** Prime battery API on Android so charging events arrive before first download. */
export function primeDownloadBatteryMonitor(): void {
  if (!isAndroid()) return;
  void readBattery().then(() => ensureBatterySubscription());
}
