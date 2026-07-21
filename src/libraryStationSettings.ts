import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const LIBRARY_STATION_ENABLED_KEY = 'sandbox_library_station_enabled';

export function loadLibraryStationEnabled(): boolean {
  const v = prefsGetItem(LIBRARY_STATION_ENABLED_KEY);
  if (v === null) return false;
  return v === 'true';
}

export function saveLibraryStationEnabled(enabled: boolean): void {
  prefsSetItem(LIBRARY_STATION_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
