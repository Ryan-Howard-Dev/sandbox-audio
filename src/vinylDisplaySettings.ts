import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const VINYL_DISPLAY_MODE_KEY = 'sandbox_vinyl_display_mode_v1';

export type VinylDisplayMode = 'manual' | 'follow-genre' | 'follow-art';

export function loadVinylDisplayMode(): VinylDisplayMode {
  const raw = prefsGetItem(VINYL_DISPLAY_MODE_KEY);
  if (raw === 'follow-genre') return 'follow-genre';
  if (raw === 'follow-art') return 'follow-art';
  return 'manual';
}

export function saveVinylDisplayMode(mode: VinylDisplayMode): void {
  prefsSetItem(VINYL_DISPLAY_MODE_KEY, mode);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
