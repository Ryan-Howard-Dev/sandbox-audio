// @vitest-environment jsdom
/**
 * Trimming caches before the store fills, rather than after it refuses a write.
 *
 * The failure this prevents was measured on a phone: localStorage at exactly the ten megabyte
 * ceiling, most of it rebuildable cache, and the writes being refused were the play queue, the
 * play history and the listening sessions. Recovering at the ceiling is too late by then, because
 * what gets dropped is whatever the app happened to try to save next.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_CEILING_BYTES,
  TRIM_ABOVE_BYTES,
  TRIM_TARGET_BYTES,
  isEvictableKey,
  measureStorage,
  planStorageTrim,
  storageUsage,
  trimStorageToBudget,
  type StorageEntry,
} from './storageBudget';

const MB = 1024 * 1024;
const entry = (key: string, mb: number): StorageEntry => ({ key, bytes: Math.round(mb * MB) });

const cache = (n: number, mb: number) => entry(`sandbox_artist_discography_cache_v3:artist${n}`, mb);
const real = (key: string, mb: number) => entry(key, mb);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('planStorageTrim', () => {
  it('does nothing while there is room', () => {
    const entries = [cache(1, 1), real('sandbox_play_history', 1)];
    expect(planStorageTrim(entries)).toEqual([]);
  });

  it('trims once past the high-water mark', () => {
    const entries = [cache(1, 3), cache(2, 3), real('sandbox_play_history', 1)];
    expect(planStorageTrim(entries).length).toBeGreaterThan(0);
  });

  it('drops the largest caches first, to get back under in the fewest removals', () => {
    // 7MB total, over the mark. The 3MB cache alone brings it to 4MB, already under the target,
    // so one removal is the right answer and the smaller two are left where they are.
    const entries = [cache(1, 0.5), cache(2, 3), cache(3, 1.5), real('sandbox_podcast_library', 2)];
    expect(planStorageTrim(entries)).toEqual(['sandbox_artist_discography_cache_v3:artist2']);
  });

  it('goes down to the target rather than just under the mark', () => {
    // Stopping at the threshold means the next cache write crosses it again, and the app spends
    // the session trimming a few kilobytes at a time.
    const entries = [cache(1, 1), cache(2, 1), cache(3, 1), cache(4, 1), cache(5, 1), cache(6, 1), cache(7, 1)];
    const dropped = new Set(planStorageTrim(entries));
    const remaining = entries.filter((e) => !dropped.has(e.key)).reduce((s, e) => s + e.bytes, 0);
    expect(remaining).toBeLessThanOrEqual(TRIM_TARGET_BYTES);
  });

  it('never removes anything the app cannot rebuild, even when that is what is large', () => {
    /*
     * The whole point. A store full of real data trims nothing and stays where it is, because
     * dropping a listening history to make room for a chart cache would be the same mistake in
     * the other direction.
     */
    const entries = [
      real('sandbox_podcast_library', 4),
      real('sandbox_play_sessions', 3),
      real('sandbox_layer4_playlists', 1),
    ];
    expect(planStorageTrim(entries)).toEqual([]);
  });

  it('trims what it can when real data is most of the store', () => {
    const entries = [real('sandbox_podcast_library', 5), cache(1, 2), cache(2, 1)];
    expect(planStorageTrim(entries)).toEqual([
      'sandbox_artist_discography_cache_v3:artist1',
      'sandbox_artist_discography_cache_v3:artist2',
    ]);
  });

  it('starts well before the ceiling', () => {
    expect(TRIM_ABOVE_BYTES).toBeLessThan(STORAGE_CEILING_BYTES);
    expect(TRIM_TARGET_BYTES).toBeLessThan(TRIM_ABOVE_BYTES);
  });
});

describe('isEvictableKey', () => {
  it('knows a cache from a record', () => {
    expect(isEvictableKey('sandbox_artist_discography_cache_v3:future')).toBe(true);
    expect(isEvictableKey('sandbox_chart_tracks_cache_v1:150')).toBe(true);
    expect(isEvictableKey('sandbox_play_queue_state_v1')).toBe(false);
    expect(isEvictableKey('sandbox_podcast_library')).toBe(false);
  });
});

describe('trimStorageToBudget against a real store', () => {
  it('removes caches and leaves records alone', () => {
    const filler = 'x'.repeat(400_000);
    for (let i = 0; i < 9; i += 1) {
      localStorage.setItem(`sandbox_artist_discography_cache_v3:a${i}`, filler);
    }
    localStorage.setItem('sandbox_play_queue_state_v1', 'queue');
    localStorage.setItem('sandbox_podcast_library', 'shows');

    const before = measureStorage(localStorage).total;
    expect(before).toBeGreaterThan(TRIM_ABOVE_BYTES);

    const result = trimStorageToBudget(localStorage);
    expect(result.after).toBeLessThanOrEqual(TRIM_TARGET_BYTES);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(localStorage.getItem('sandbox_play_queue_state_v1')).toBe('queue');
    expect(localStorage.getItem('sandbox_podcast_library')).toBe('shows');
  });

  it('is a no-op on a store with room, so it can be called on a timer', () => {
    localStorage.setItem('sandbox_play_queue_state_v1', 'queue');
    const result = trimStorageToBudget(localStorage);
    expect(result.removed).toEqual([]);
    expect(result.before).toBe(result.after);
  });

  it('reports how full the store is', () => {
    localStorage.setItem('sandbox_chart_tracks_cache_v1:150', 'x'.repeat(100_000));
    const usage = storageUsage(localStorage);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(usage.fraction).toBeGreaterThan(0);
    expect(usage.fraction).toBeLessThan(1);
  });
});
