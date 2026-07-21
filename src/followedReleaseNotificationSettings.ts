import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const FOLLOWED_RELEASE_NOTIF_ENABLED_KEY = 'sandbox_followed_release_notif_enabled';
export const FOLLOWED_RELEASE_NOTIF_CHANGE_EVENT = 'sandbox-followed-release-notif-change';

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

/** Default ON — badge on Discover when followed artists release new music. */
export function loadFollowedReleaseNotifEnabled(): boolean {
  return loadBool(FOLLOWED_RELEASE_NOTIF_ENABLED_KEY, true);
}

export function saveFollowedReleaseNotifEnabled(enabled: boolean): void {
  prefsSetItem(FOLLOWED_RELEASE_NOTIF_ENABLED_KEY, String(enabled));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FOLLOWED_RELEASE_NOTIF_CHANGE_EVENT));
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}
