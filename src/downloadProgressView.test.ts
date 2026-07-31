import { describe, expect, it } from 'vitest';
import type { DownloadJob, TrackDownloadState } from './downloadQueue';
import {
  findCollectionDownloadJob,
  isTrackDownloadInFlight,
  selectCollectionDownloadProgress,
  selectTrackDownloadState,
} from './downloadProgressView';

function track(
  trackId: string,
  title: string,
  status: TrackDownloadState['status'],
  percent = 0,
): TrackDownloadState {
  return { trackId, title, status, percent };
}

function job(over: Partial<DownloadJob> & { id: string }): DownloadJob {
  return {
    label: 'VULTURES 1',
    artist: 'Kanye West',
    mode: 'album',
    tier: 'best',
    status: 'downloading',
    progress: 0,
    totalTracks: 0,
    completedTracks: 0,
    tracks: {},
    startedAt: 0,
    ...over,
  } as DownloadJob;
}

describe('findCollectionDownloadJob', () => {
  const albumJob = job({ id: 'j1', albumId: 'alb-1' });
  const playlistJob = job({ id: 'j2', mode: 'tracks', playlistId: 'pl-9' });
  const jobs = [albumJob, playlistJob];

  it('matches an album job by id', () => {
    expect(findCollectionDownloadJob(jobs, { albumId: 'alb-1' })?.id).toBe('j1');
  });

  it('matches a playlist job by id', () => {
    expect(findCollectionDownloadJob(jobs, { playlistId: 'pl-9' })?.id).toBe('j2');
  });

  it('returns nothing when the collection has no id to match on', () => {
    expect(findCollectionDownloadJob(jobs, {})).toBeUndefined();
    expect(findCollectionDownloadJob(jobs, { albumId: '  ' })).toBeUndefined();
  });
});

describe('selectCollectionDownloadProgress', () => {
  it('reports weighted percent across the job tracks', () => {
    const jobs = [
      job({
        id: 'j1',
        albumId: 'alb-1',
        tracks: {
          a: track('a', 'One', 'done', 100),
          b: track('b', 'Two', 'downloading', 50),
        },
      }),
    ];
    const progress = selectCollectionDownloadProgress(jobs, { albumId: 'alb-1' })!;
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.percent).toBe(75);
    expect(progress.active).toBe(true);
  });

  it('goes inactive once every track is processed, so the bar does not linger', () => {
    const jobs = [
      job({
        id: 'j1',
        albumId: 'alb-1',
        status: 'done',
        tracks: { a: track('a', 'One', 'done', 100) },
      }),
    ];
    expect(selectCollectionDownloadProgress(jobs, { albumId: 'alb-1' })?.active).toBe(false);
  });

  it('counts failures without blocking completion', () => {
    const jobs = [
      job({
        id: 'j1',
        albumId: 'alb-1',
        tracks: {
          a: track('a', 'One', 'done', 100),
          b: track('b', 'Two', 'error'),
        },
      }),
    ];
    const progress = selectCollectionDownloadProgress(jobs, { albumId: 'alb-1' })!;
    expect(progress.failed).toBe(1);
    expect(progress.active).toBe(false);
  });

  it('returns null when nothing is downloading for the collection', () => {
    expect(selectCollectionDownloadProgress([], { albumId: 'alb-1' })).toBeNull();
  });
});

describe('selectTrackDownloadState', () => {
  const jobs = [
    job({
      id: 'j1',
      tracks: {
        '1001': track('1001', 'CARNIVAL', 'downloading', 42),
        '1002': track('1002', 'BURN', 'queued' as TrackDownloadState['status']),
      },
    }),
  ];

  it('matches on catalog track id', () => {
    expect(selectTrackDownloadState(jobs, { trackId: '1001' })?.percent).toBe(42);
  });

  it('falls back to title when the row carries no catalog id', () => {
    expect(selectTrackDownloadState(jobs, { title: 'CARNIVAL' })?.trackId).toBe('1001');
  });

  it('tolerates feat. variants between the listing and the row', () => {
    expect(
      selectTrackDownloadState(jobs, { title: 'CARNIVAL (feat. Playboi Carti)' })?.trackId,
    ).toBe('1001');
  });

  it('returns null with nothing to match on', () => {
    expect(selectTrackDownloadState(jobs, {})).toBeNull();
    expect(selectTrackDownloadState(jobs, { title: 'Not Queued' })).toBeNull();
  });
});

describe('isTrackDownloadInFlight', () => {
  it('is true only for non-terminal states', () => {
    expect(isTrackDownloadInFlight(track('a', 'x', 'downloading', 10))).toBe(true);
    expect(isTrackDownloadInFlight(track('a', 'x', 'resolving'))).toBe(true);
    expect(isTrackDownloadInFlight(track('a', 'x', 'done', 100))).toBe(false);
    expect(isTrackDownloadInFlight(track('a', 'x', 'error'))).toBe(false);
    expect(isTrackDownloadInFlight(track('a', 'x', 'skipped'))).toBe(false);
    expect(isTrackDownloadInFlight(null)).toBe(false);
  });
});
