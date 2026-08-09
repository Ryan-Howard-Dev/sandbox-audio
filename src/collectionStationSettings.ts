import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const COLLECTION_STATION_ENABLED_KEY = 'sandbox_collection_station_enabled';

/**
 * Whether the physical collection is offered at all.
 *
 * Default off, unlike the stations that predate it. Every other toggle defaults on because those
 * destinations were already in the nav when the switch was added and turning them off under
 * somebody would have been a change they never asked for. This one is new, so nobody is losing
 * anything by it starting quiet — and a listener with no records on a shelf should not have to
 * find a switch to remove a thing they never wanted.
 */
export function loadCollectionStationEnabled(): boolean {
  return prefsGetItem(COLLECTION_STATION_ENABLED_KEY) === 'true';
}

export function saveCollectionStationEnabled(enabled: boolean): void {
  prefsSetItem(COLLECTION_STATION_ENABLED_KEY, String(enabled));
  // The shell reads this on the settings event; without it the More menu keeps its old entries
  // until the next remount.
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
