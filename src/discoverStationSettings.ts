import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';

export const DISCOVER_STATION_ENABLED_KEY = 'sandbox_discover_station_enabled';
export const DISCOVERY_STATION_SKIP_ONLY_KEY = 'sandbox_discovery_station_skip_only';

/** @deprecated Migrated into discover station toggle — read-only for migration. */
export const LEGACY_FEED_STATION_ENABLED_KEY = 'sandbox_feed_station_enabled';

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

/** Default ON — Feed was always in nav for existing users. */
export function loadDiscoverStationEnabled(): boolean {
  const discover = prefsGetItem(DISCOVER_STATION_ENABLED_KEY);
  if (discover !== null) return discover === 'true';
  return loadBool(LEGACY_FEED_STATION_ENABLED_KEY, true);
}

export function saveDiscoverStationEnabled(enabled: boolean): void {
  prefsSetItem(DISCOVER_STATION_ENABLED_KEY, String(enabled));
  prefsRemoveItem(LEGACY_FEED_STATION_ENABLED_KEY);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function loadDiscoveryStationSkipOnly(): boolean {
  return loadBool(DISCOVERY_STATION_SKIP_ONLY_KEY, false);
}

export function saveDiscoveryStationSkipOnly(enabled: boolean): void {
  prefsSetItem(DISCOVERY_STATION_SKIP_ONLY_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
