import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const AUDIOBOOKS_ENABLED_KEY = 'sandbox_audiobooks_enabled';

/** Default on — user asked for the station; can still toggle off in Settings. */
export function loadAudiobooksEnabled(): boolean {
  const v = prefsGetItem(AUDIOBOOKS_ENABLED_KEY);
  if (v === null) return true;
  return v === 'true';
}

export function saveAudiobooksEnabled(enabled: boolean): void {
  prefsSetItem(AUDIOBOOKS_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
