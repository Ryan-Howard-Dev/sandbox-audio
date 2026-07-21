import React, { lazy } from 'react';
import AppErrorBoundary from '../components/AppErrorBoundary';
import { StationChunkFallback } from './StationChunkFallback';

export { StationChunkFallback };

/** Code-split heavy station views — loaded on first navigation. */
export const LazyDiscoverStationView = lazy(
  () => import('../stations/DiscoverStationView'),
);
export const LazySettingsView = lazy(() => import('../stations/SettingsView'));
export const LazySearchResultsView = lazy(
  () => import('../stations/SearchResultsView'),
);
export const LazyArtistDetailView = lazy(
  () => import('../stations/ArtistDetailView'),
);
export const LazyDJStationView = lazy(() => import('../stations/DJStationView'));
export const LazySonicLockerStationView = lazy(
  () => import('../stations/SonicLockerStationView'),
);
export const LazyPodcastsView = lazy(() => import('../stations/PodcastsView'));
export const LazyAudiobooksView = lazy(() => import('../stations/AudiobooksView'));
export const LazyCollectionView = lazy(
  () => import('../stations/CollectionView'),
);
export const LazyListeningStatsView = lazy(
  () => import('../stations/ListeningStatsView'),
);
export const LazyLibraryStationView = lazy(
  () => import('../stations/LibraryStationView'),
);

export function withStationSuspense(node: React.ReactNode, label = 'station'): React.ReactNode {
  return (
    <AppErrorBoundary label={label}>
      <React.Suspense fallback={<StationChunkFallback />}>{node}</React.Suspense>
    </AppErrorBoundary>
  );
}
