import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { CatalogTrack } from '../searchCatalog';
import {
  mergeSimilarRadioIntoQueue,
  shouldAutoStartSimilarRadio,
} from './standaloneSimilarRadio';

function env(id: string, title: string): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    url: 'https://stream.example/track',
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

describe('standaloneSimilarRadio', () => {
  it('starts for a lone track outside album drill', () => {
    const envelope = env('single-1', 'Lone Single');
    expect(
      shouldAutoStartSimilarRadio({
        envelope,
        playQueue: [],
        searchHits: [],
      }),
    ).toBe(true);
  });

  it('skips album drill multi-track play', () => {
    const albumTracks = [track('t1', 'One', 1), track('t2', 'Two', 2)];
    const hits = [hit('t1', 'One'), hit('t2', 'Two')];
    const envelope = hits[0]!.primaryEnvelope;
    expect(
      shouldAutoStartSimilarRadio({
        envelope,
        playQueue: [],
        albumTracks,
        searchHits: hits,
        albumTitle: 'Album',
        expectedTrackCount: 2,
      }),
    ).toBe(false);
  });

  it('seedSearchQueue overrides stale album-drill listing (locker single)', () => {
    const albumTracks = [track('t1', 'Nee Nah', 1), track('t2', 'Redrum', 2)];
    const hits = [hit('t1', 'Nee Nah'), hit('t2', 'Redrum')];
    const envelope = hits[0]!.primaryEnvelope;
    expect(
      shouldAutoStartSimilarRadio({
        envelope,
        playQueue: [envelope],
        albumTracks,
        searchHits: hits,
        albumTitle: 'american dream',
        expectedTrackCount: 16,
        seedSearchQueue: true,
      }),
    ).toBe(true);
  });

  it('skips when navigating within an existing multi-track queue', () => {
    const queue = [env('a', 'A'), env('b', 'B')];
    expect(
      shouldAutoStartSimilarRadio({
        envelope: queue[1]!,
        playQueue: queue,
        searchHits: [],
      }),
    ).toBe(false);
  });

  it('allows search single play even when search queue has many hits', () => {
    const queue = [env('a', 'A'), env('b', 'B')];
    expect(
      shouldAutoStartSimilarRadio({
        envelope: env('c', 'C'),
        playQueue: queue,
        searchHits: [],
        seedSearchQueue: true,
      }),
    ).toBe(true);
  });

  it('stale mixRadioSession alone does not block a new single', () => {
    expect(
      shouldAutoStartSimilarRadio({
        envelope: env('solo', 'Solo'),
        playQueue: [env('solo', 'Solo')],
        searchHits: [],
        hasMixRadioSession: true,
      }),
    ).toBe(true);
  });

  it('blocks when already mid multi-track radio including this seed', () => {
    const queue = [env('a', 'A'), env('b', 'B')];
    expect(
      shouldAutoStartSimilarRadio({
        envelope: queue[0]!,
        playQueue: queue,
        searchHits: [],
        hasMixRadioSession: true,
      }),
    ).toBe(false);
  });

  it('mergeSimilarRadioIntoQueue keeps current track index', () => {
    const current = env('seed', 'Seed');
    const similar = [current, env('next', 'Next'), env('after', 'After')];
    const merged = mergeSimilarRadioIntoQueue(current, similar);
    expect(merged.index).toBe(0);
    expect(merged.queue.map((t) => t.envelopeId)).toEqual(['seed', 'next', 'after']);
  });

  it('mergeSimilarRadioIntoQueue drops consecutive duplicate envelopeIds', () => {
    const current = env('seed', 'Seed');
    const dup = env('seed', 'Seed');
    const next = env('next', 'Next');
    const merged = mergeSimilarRadioIntoQueue(current, [current, dup, next]);
    expect(merged.queue.map((t) => t.envelopeId)).toEqual(['seed', 'next']);
  });
});
