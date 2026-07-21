import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { CatalogTrack } from '../searchCatalog';
import {
  buildAlbumPlayQueueEnvelopes,
  computePlayQueueSeed,
} from './albumPlayQueue';

function env(id: string, title: string, url = 'https://stream.example/track'): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    url,
    durationSeconds: 180,
    provider: 'https',
    transport: 'element-src',
    sourceId: id,
  };
}

function hit(id: string, title: string): ResolvedSearchHit {
  return {
    identityId: id,
    title,
    artist: 'Artist',
    sources: [],
    primaryEnvelope: env(id, title),
  };
}

function track(id: string, title: string, trackNumber: number): CatalogTrack {
  return {
    kind: 'track',
    id,
    title,
    artist: 'Artist',
    album: 'Album',
    trackNumber,
  };
}

describe('albumPlayQueue', () => {
  it('orders envelopes by album tracklist not search hit order', () => {
    const albumTracks = [
      track('track-1', 'FIRST NIGHT', 1),
      track('track-2', 'FLY AWAY', 2),
      track('track-3', 'OUTRO', 3),
    ];
    const displayHits = [
      hit('track-2', 'FLY AWAY'),
      hit('track-1', 'FIRST NIGHT'),
      hit('track-3', 'OUTRO'),
    ];

    const queue = buildAlbumPlayQueueEnvelopes(displayHits, albumTracks, 'Album', 3);
    expect(queue.map((e) => e.title)).toEqual(['FIRST NIGHT', 'FLY AWAY', 'OUTRO']);
  });

  it('computePlayQueueSeed returns album-order index for tapped track', () => {
    const albumTracks = [
      track('track-1', 'FIRST NIGHT', 1),
      track('track-2', 'FLY AWAY', 2),
    ];
    const displayHits = [hit('track-2', 'FLY AWAY'), hit('track-1', 'FIRST NIGHT')];
    const tapped = displayHits[1]!.primaryEnvelope;

    const seed = computePlayQueueSeed(tapped, {
      searchHits: displayHits,
      searchResults: [],
      albumTracks,
      albumTitle: 'Album',
      expectedTrackCount: 2,
    });

    expect(seed?.index).toBe(0);
    expect(seed?.queue[0]?.title).toBe('FIRST NIGHT');
    expect(seed?.queue[1]?.title).toBe('FLY AWAY');
  });

  it('falls back to search hit order when album tracks are missing', () => {
    const displayHits = [hit('a', 'Alpha'), hit('b', 'Beta')];
    const seed = computePlayQueueSeed(displayHits[1]!.primaryEnvelope, {
      searchHits: displayHits,
      searchResults: [],
    });
    expect(seed?.index).toBe(1);
    expect(seed?.queue.map((e) => e.title)).toEqual(['Alpha', 'Beta']);
  });

  it('excludes album placeholders without stream URLs from seeded queue', () => {
    const playable = env('track-2', 'FLY AWAY', 'https://audio.example/fly-away');
    const placeholder = env('track-3', 'OUTRO', '');
    const displayHits = [
      hit('track-1', 'FIRST NIGHT'),
      { ...hit('track-2', 'FLY AWAY'), primaryEnvelope: playable },
      { ...hit('track-3', 'OUTRO'), primaryEnvelope: placeholder },
    ];
    const albumTracks = [
      track('track-1', 'FIRST NIGHT', 1),
      track('track-2', 'FLY AWAY', 2),
      track('track-3', 'OUTRO', 3),
    ];

    const queue = buildAlbumPlayQueueEnvelopes(displayHits, albumTracks, 'Album', 3);
    expect(queue.map((e) => e.title)).toEqual(['FIRST NIGHT', 'FLY AWAY']);

    const seed = computePlayQueueSeed(playable, {
      searchHits: displayHits,
      searchResults: [],
      albumTracks,
      albumTitle: 'Album',
      expectedTrackCount: 3,
    });
    expect(seed?.index).toBe(1);
    expect(seed?.queue.map((e) => e.title)).toEqual(['FIRST NIGHT', 'FLY AWAY']);
  });

  it('seedSearchOnly ignores stale album drill and falls back to lone tap', () => {
    const albumTracks = [
      track('track-1', 'FIRST NIGHT', 1),
      track('track-2', 'FLY AWAY', 2),
    ];
    const lockerSingle = env('local-locker-1', 'Nee Nah', 'content://locker/nee-nah');

    const seed = computePlayQueueSeed(lockerSingle, {
      searchHits: [],
      searchResults: [],
      albumTracks,
      albumTitle: 'american dream',
      expectedTrackCount: 16,
      seedSearchOnly: true,
    });

    expect(seed?.queue).toEqual([lockerSingle]);
    expect(seed?.index).toBe(0);
  });

  it('seedSearchOnly prefers search hits over stale album drill', () => {
    const albumTracks = [
      track('track-1', 'FIRST NIGHT', 1),
      track('track-2', 'FLY AWAY', 2),
    ];
    const displayHits = [hit('track-2', 'FLY AWAY'), hit('track-1', 'FIRST NIGHT')];
    const lockerSingle = env('local-locker-1', 'Nee Nah', 'content://locker/nee-nah');

    const seed = computePlayQueueSeed(lockerSingle, {
      searchHits: displayHits,
      searchResults: [],
      albumTracks,
      albumTitle: 'american dream',
      expectedTrackCount: 16,
      seedSearchOnly: true,
    });

    expect(seed?.queue.map((e) => e.envelopeId)).toEqual([
      'local-locker-1',
      'track-2',
      'track-1',
    ]);
    expect(seed?.index).toBe(0);
  });
});
