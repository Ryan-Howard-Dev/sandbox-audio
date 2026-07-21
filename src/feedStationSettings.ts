/**
 * @deprecated Use discoverStationSettings — kept for imports that referenced feed-only toggle.
 */
export {
  DISCOVER_STATION_ENABLED_KEY,
  LEGACY_FEED_STATION_ENABLED_KEY as FEED_STATION_ENABLED_KEY,
  loadDiscoverStationEnabled as loadFeedStationEnabled,
  saveDiscoverStationEnabled as saveFeedStationEnabled,
} from './discoverStationSettings';
