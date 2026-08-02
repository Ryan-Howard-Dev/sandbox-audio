import { describe, expect, it } from 'vitest';
import {
  downloadJobMediaKind,
  filterDownloadJobsByKind,
} from './DownloadActivitySheet';
import type { DownloadJob } from '../downloadQueue';

function job(partial: Partial<DownloadJob> & Pick<DownloadJob, 'id' | 'label'>): DownloadJob {
  return {
    artist: '',
    mode: 'tracks',
    tier: 'best',
    status: 'queued',
    progress: 0,
    totalTracks: 0,
    completedTracks: 0,
    tracks: {},
    startedAt: 0,
    ...partial,
  };
}

describe('downloadJobMediaKind', () => {
  it('classifies podcast track ids via playEventKind', () => {
    expect(
      downloadJobMediaKind(
        job({
          id: 'dl-pod',
          label: 'Episode',
          tracks: {
            'podcast:feed:ep1': {
              trackId: 'podcast:feed:ep1',
              title: 'Ep',
              status: 'downloading',
              percent: 10,
            },
          },
        }),
      ),
    ).toBe('podcast');
  });

  it('classifies audiobook track ids via playEventKind', () => {
    expect(
      downloadJobMediaKind(
        job({
          id: 'dl-book',
          label: 'Book',
          tracks: {
            'audiobook:lib:1': {
              trackId: 'audiobook:lib:1',
              title: 'Ch 1',
              status: 'pending',
              percent: 0,
            },
          },
        }),
      ),
    ).toBe('audiobook');
  });

  it('treats unprefixed catalog ids as music', () => {
    expect(
      downloadJobMediaKind(
        job({
          id: 'dl-music',
          label: 'Album',
          tracks: {
            'mbid-track-1': {
              trackId: 'mbid-track-1',
              title: 'Song',
              status: 'pending',
              percent: 0,
            },
          },
        }),
      ),
    ).toBe('music');
  });

  it('defaults empty jobs to music', () => {
    expect(downloadJobMediaKind(job({ id: 'dl-empty', label: 'Pending' }))).toBe('music');
  });
});

describe('filterDownloadJobsByKind', () => {
  const jobs = [
    job({
      id: 'a',
      label: 'Pod',
      tracks: {
        'podcast:f:e': { trackId: 'podcast:f:e', title: 'E', status: 'done', percent: 100 },
      },
    }),
    job({
      id: 'b',
      label: 'Song',
      tracks: {
        'yt:abc': { trackId: 'yt:abc', title: 'S', status: 'done', percent: 100 },
      },
    }),
  ];

  it('keeps only the requested station kind', () => {
    expect(filterDownloadJobsByKind(jobs, 'podcast').map((j) => j.id)).toEqual(['a']);
    expect(filterDownloadJobsByKind(jobs, 'music').map((j) => j.id)).toEqual(['b']);
  });
});
