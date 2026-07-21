/**
 * Battery saver — reduces animations, polling, and background work on mobile.
 * Defaults ON for Capacitor native (phone/tablet APK).
 */

import { isCapacitorNative } from './platformEnv';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

const KEY = 'sandbox_battery_saver_v1';
export const BATTERY_SAVER_CHANGE_EVENT = 'sandbox-battery-saver-change';

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BATTERY_SAVER_CHANGE_EVENT));
  }
}

export function loadBatterySaverEnabled(): boolean {
  const raw = prefsGetItem(KEY);
  if (raw === null) return isCapacitorNative();
  return raw === 'true';
}

export function saveBatterySaverEnabled(enabled: boolean): void {
  prefsSetItem(KEY, enabled ? 'true' : 'false');
  notify();
}

export function isBatterySaverEnabled(): boolean {
  return loadBatterySaverEnabled();
}

export function subscribeBatterySaver(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Poll interval multiplier when battery saver is on. */
export function batterySaverPollMultiplier(): number {
  return isBatterySaverEnabled() ? 2.5 : 1;
}
