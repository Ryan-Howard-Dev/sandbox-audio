import React, { lazy } from 'react';
import { StationChunkFallback } from '../shell/StationChunkFallback';

export const LazyDiscoverFeedView = lazy(() => import('./FeedView'));
export const LazyDiscoverHomeView = lazy(() => import('./DiscoverHomeView'));
export const LazyFeedDiscoverHomeSection = lazy(() => import('./FeedDiscoverHomeSection'));
export const LazyDiscoverExploreView = lazy(() => import('./ExploreView'));
export const LazyDiscoverPlaylistsView = lazy(() => import('./PlaylistsView'));

export function DiscoverTabSuspense({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<StationChunkFallback />}>{children}</React.Suspense>
  );
}
