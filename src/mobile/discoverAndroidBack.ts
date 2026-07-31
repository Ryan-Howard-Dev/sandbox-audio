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

  /*
   * A recorded drill origin IS the back entry — honour it before any tab default. Checking
   * `discoverTab === 'explore'` first used to short-circuit this, so opening Browse from
   * Playlists sent back to Feed and silently dropped the Playlists entry; drilling the other
   * way (into Feed from Browse) fell through to `handled: false` and minimized the app.
   */
  if (input.discoverDrillFromTab && input.discoverDrillFromTab !== input.discoverTab) {
    return { handled: true, nextTab: input.discoverDrillFromTab, clearDrill: true };
  }

  // No origin recorded: every non-root tab falls back to Feed, the discover root.
  if (input.discoverTab !== 'feed') {
    return { handled: true, nextTab: 'feed', clearDrill: true };
  }

  // Feed is root — return unhandled so the shell may minimize.
  return { handled: false };
}
