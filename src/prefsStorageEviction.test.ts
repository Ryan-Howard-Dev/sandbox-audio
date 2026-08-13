/**
 * The evictable list must keep covering the caches that actually exist.
 *
 * It had drifted: it named sandbox_catalog_cache and sandbox_explore_cache while the real keys
 * were sandbox_catalog_search_cache_v1 and sandbox_explore_cache_v2. Eviction therefore matched
 * nothing on a full store, the retry failed the same way the first attempt had, and the writes
 * being refused were the queue, the play history and the listening sessions. The app was dropping
 * what it cannot rebuild to keep what it can.
 *
 * Two strings in two files will drift again. This is what notices.
 */

import { describe, expect, it } from 'vitest';
import { EVICTABLE_KEY_PREFIXES } from './prefsStorage';
import { CACHE_KEYS } from './responseCache';

const covered = (key: string) => EVICTABLE_KEY_PREFIXES.some((p) => key.startsWith(p));

describe('evictable cache prefixes', () => {
  it('covers every response cache the app defines', () => {
    const missed = Object.entries(CACHE_KEYS)
      .filter(([, key]) => !covered(key))
      .map(([name, key]) => `${name} (${key})`);
    expect(missed).toEqual([]);
  });

  it('covers the per-artist and per-query keys those caches build', () => {
    // These are stored one entry per artist or per query, which is how the store filled up.
    expect(covered('sandbox_artist_discography_cache_v3:future|local-artist-future')).toBe(true);
    expect(covered('sandbox_chart_tracks_cache_v1:150')).toBe(true);
    expect(covered('sandbox_discovery_cache:anything')).toBe(true);
  });

  it('covers older discography cache versions still on disk', () => {
    // A device that has been through upgrades still carries the previous versions, and they are
    // just as evictable as the current one.
    expect(covered('sandbox_artist_discography_cache_v1:x')).toBe(true);
    expect(covered('sandbox_artist_discography_cache_v2:x')).toBe(true);
  });

  it('never evicts anything the app cannot rebuild', () => {
    for (const key of [
      'sandbox_play_queue_state_v1',
      'sandbox_play_history',
      'sandbox_play_sessions',
      'sandbox_podcast_library',
      'sandbox_layer4_playlists',
      'sandbox_locker_imported_manifest',
      'sandbox_translation_models_v1',
    ]) {
      expect(covered(key)).toBe(false);
    }
  });
});
