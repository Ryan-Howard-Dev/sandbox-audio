/**
 * Read-side selectors for showing download progress inline in collection views.
 *
 * The activity sheet answers "what is downloading?" globally. These answer the narrower
 * question a track row and a collection header need: "is *this* item downloading, and how far
 * along?" — so progress can live next to the content instead of behind a floating button.
 *
 * Pure by design (jobs are passed in, never read from module state) so the matching rules are
 * testable without driving the real queue.
 */

import {
  computeAlbumDownloadProgress,
  trackTitleKeysMatch,
  type DownloadJob,
  type TrackDownloadState,
} from './downloadQueue';

export interface CollectionDownloadProgress {
  percent: number;
  /** Tracks saved or already in the locker. */
  completed: number;
  failed: number;
  total: number;
  /** Still working — drives whether the bar is shown at all. */
  active: boolean;
}

export interface CollectionDownloadTarget {
  albumId?: string | null;
  playlistId?: string | null;
}

function isTerminal(job: DownloadJob): boolean {
  return job.status === 'done';
}

/** The job covering a collection. Ids only — title matching belongs to track lookup. */
export function findCollectionDownloadJob(
  jobs: DownloadJob[],
  target: CollectionDownloadTarget,
): DownloadJob | undefined {
  const albumId = target.albumId?.trim();
  const playlistId = target.playlistId?.trim();
  if (!albumId && !playlistId) return undefined;
  return jobs.find((job) => {
    if (playlistId && job.playlistId === playlistId) return true;
    if (albumId && job.albumId === albumId) return true;
    return false;
  });
}

export function selectCollectionDownloadProgress(
  jobs: DownloadJob[],
  target: CollectionDownloadTarget,
): CollectionDownloadProgress | null {
  const job = findCollectionDownloadJob(jobs, target);
  if (!job) return null;
  const stats = computeAlbumDownloadProgress(job);
  return {
    percent: stats.percent,
    completed: stats.completed,
    failed: stats.failed,
    total: stats.total,
    // A finished job keeps its row in the queue; the header bar should not linger for it.
    active: !isTerminal(job) && stats.processed < stats.total,
  };
}

export interface TrackDownloadLookup {
  trackId?: string | null;
  title?: string | null;
}

/**
 * Per-track state for a row. Catalog ids are exact when present, but album listings and
 * envelopes do not always agree on id shape, so title matching (already fuzzy enough to
 * survive "feat." variants) is the fallback rather than showing nothing.
 */
export function selectTrackDownloadState(
  jobs: DownloadJob[],
  lookup: TrackDownloadLookup,
): TrackDownloadState | null {
  const trackId = lookup.trackId?.trim();
  const title = lookup.title?.trim();
  if (!trackId && !title) return null;

  if (trackId) {
    for (const job of jobs) {
      const state = job.tracks?.[trackId];
      if (state) return state;
    }
  }

  if (!title) return null;
  for (const job of jobs) {
    for (const state of Object.values(job.tracks ?? {})) {
      if (state.title && trackTitleKeysMatch(state.title, title)) return state;
    }
  }
  return null;
}

/** True while a row should render a progress affordance rather than a finished state. */
export function isTrackDownloadInFlight(state: TrackDownloadState | null): boolean {
  if (!state) return false;
  return (
    state.status === 'pending' ||
    state.status === 'resolving' ||
    state.status === 'downloading' ||
    state.status === 'metadata'
  );
}
