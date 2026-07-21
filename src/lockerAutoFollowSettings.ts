import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const LOCKER_AUTO_FOLLOW_ENABLED_KEY = 'sandbox_locker_auto_follow_enabled';
export const LOCKER_AUTO_FOLLOW_CHANGE_EVENT = 'sandbox-locker-auto-follow-change';

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

/** Default ON — follow locker artists automatically for Feed updates. */
export function loadLockerAutoFollowEnabled(): boolean {
  return loadBool(LOCKER_AUTO_FOLLOW_ENABLED_KEY, true);
}

export function saveLockerAutoFollowEnabled(enabled: boolean): void {
  prefsSetItem(LOCKER_AUTO_FOLLOW_ENABLED_KEY, String(enabled));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LOCKER_AUTO_FOLLOW_CHANGE_EVENT));
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}
