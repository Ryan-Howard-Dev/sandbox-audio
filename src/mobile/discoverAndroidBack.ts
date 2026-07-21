import type { DiscoverTabId } from '../stations/DiscoverStationView';

export type DiscoverHardwareBackResult =
  | { handled: true; nextTab: DiscoverTabId; clearDrill: boolean }
  | { handled: false };

/**
 * Android hardware back inside the Discover station.
 * Feed ("For you") is root — return unhandled so the shell may minimize.
 */
export function resolveDiscoverHardwareBack(input: {
  station: string;
  discoverTab: DiscoverTabId;
  discoverDrillFromTab: DiscoverTabId | null;
}): DiscoverHardwareBackResult {
  if (input.station !== 'discover') {
    return { handled: false };
  }

  if (input.discoverTab === 'explore') {
    return { handled: true, nextTab: 'feed', clearDrill: true };
  }

  if (input.discoverTab === 'playlists' || input.discoverDrillFromTab != null) {
    return { handled: true, nextTab: 'feed', clearDrill: true };
  }

  return { handled: false };
}
