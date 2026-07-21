/**
 * Android background mini-player style — persisted via prefsStorage.
 *
 * - off: notification + lock screen only (no auto PiP)
 * - pip: enter Picture-in-Picture when the app goes to background while playing
 * - topBar: rich MediaStyle notification for system now-playing (OEM top pill when supported)
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type AndroidMiniPlayerMode = 'off' | 'pip' | 'topBar';

export const ANDROID_MINI_PLAYER_MODE_KEY = 'sandbox_android_mini_player_mode';

export function loadAndroidMiniPlayerMode(): AndroidMiniPlayerMode {
  const v = prefsGetItem(ANDROID_MINI_PLAYER_MODE_KEY);
  if (v === 'pip' || v === 'topBar' || v === 'off') return v;
  return 'off';
}

export function saveAndroidMiniPlayerMode(mode: AndroidMiniPlayerMode): void {
  prefsSetItem(ANDROID_MINI_PLAYER_MODE_KEY, mode);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
