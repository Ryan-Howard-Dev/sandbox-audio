import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const SONIC_LOCKER_STATION_ENABLED_KEY = 'sandbox_sonic_locker_station_enabled';

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

/** Default OFF — opt-in like Podcasts station. */
export function loadSonicLockerStationEnabled(): boolean {
  return loadBool(SONIC_LOCKER_STATION_ENABLED_KEY, false);
}

export function saveSonicLockerStationEnabled(enabled: boolean): void {
  prefsSetItem(SONIC_LOCKER_STATION_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
