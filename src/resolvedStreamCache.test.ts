// @vitest-environment jsdom
// localStorage is the point of the persistence half; the default node env has none.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TTL_MS,
  EXPIRY_SAFETY_MARGIN_MS,
  MAX_ENTRIES,
  cacheResolvedStream,
  clearResolvedStreamCache,
  getCachedResolvedStream,
  parseStreamExpiry,
  reloadResolvedStreamCache,
  resolvedStreamCacheSize,
} from './resolvedStreamCache';

const NOW = 1_785_225_000_000;

function stream(uri: string, bitrate = 128) {
  return { uri, bitrate, format: 'm4a', watchUrl: 'https://example.test/watch' };
}

beforeEach(() => {
  clearResolvedStreamCache();
});

describe('parseStreamExpiry', () => {
  it('reads the expiry the URL states, in seconds', () => {
    // Taken from a real resolved URL on device.
    const uri = 'https://rr2.googlevideo.com/videoplayback?expire=1785246619&ei=Ol9oas&itag=18';
    expect(parseStreamExpiry(uri, NOW)).toBe(1_785_246_619_000);
  });

  it('accepts millisecond expiries', () => {
    expect(parseStreamExpiry(`https://x.test/a?expire=${NOW + 60_000}`, NOW)).toBe(NOW + 60_000);
  });

  it('returns null when there is no expiry to read', () => {
    expect(parseStreamExpiry('https://x.test/a?itag=18', NOW)).toBeNull();
  });

  it('ignores an expiry already in the past', () => {
    // A malformed value parsing to 1970 would otherwise poison the entry permanently.
    expect(parseStreamExpiry('https://x.test/a?expire=1000000000', NOW)).toBeNull();
  });

  it('ignores an implausibly distant expiry', () => {
    // Signed media URLs do not last a year; treating one as valid would cache a dead URL forever.
    const farFuture = Math.floor((NOW + 400 * 24 * 3600 * 1000) / 1000);
    expect(parseStreamExpiry(`https://x.test/a?expire=${farFuture}`, NOW)).toBeNull();
  });

  it('does not match a longer parameter name ending in expire', () => {
    expect(parseStreamExpiry('https://x.test/a?noexpire=1785246619', NOW)).toBeNull();
  });
});

describe('resolved stream cache', () => {
  it('returns a stream it just cached', () => {
    const s = stream(`https://x.test/a?expire=${Math.floor((NOW + 3600_000) / 1000)}`);
    cacheResolvedStream('kendrick lamar humble', s, NOW);
    const hit = getCachedResolvedStream('kendrick lamar humble', NOW);
    expect(hit?.uri).toBe(s.uri);
    expect(hit?.bitrate).toBe(128);
    expect(hit?.format).toBe('m4a');
  });

  it('matches regardless of case and spacing', () => {
    cacheResolvedStream('Kendrick Lamar  HUMBLE', stream('https://x.test/a'), NOW);
    expect(getCachedResolvedStream('kendrick lamar humble', NOW)).not.toBeNull();
  });

  it('refuses a URL close enough to expiry to die mid-track', () => {
    // The failure would arrive as a stall partway through a song, not at the point of use.
    const soon = NOW + EXPIRY_SAFETY_MARGIN_MS - 1000;
    cacheResolvedStream('q', stream(`https://x.test/a?expire=${Math.floor(soon / 1000)}`), NOW);
    expect(getCachedResolvedStream('q', NOW)).toBeNull();
  });

  it('expires an entry once the margin is reached', () => {
    const expiry = NOW + 60 * 60 * 1000;
    cacheResolvedStream('q', stream(`https://x.test/a?expire=${Math.floor(expiry / 1000)}`), NOW);
    expect(getCachedResolvedStream('q', expiry - EXPIRY_SAFETY_MARGIN_MS - 1)).not.toBeNull();
    expect(getCachedResolvedStream('q', expiry - EXPIRY_SAFETY_MARGIN_MS + 1)).toBeNull();
  });

  it('falls back to a bounded TTL when the URL states no expiry', () => {
    cacheResolvedStream('q', stream('https://x.test/a'), NOW);
    expect(getCachedResolvedStream('q', NOW + DEFAULT_TTL_MS - EXPIRY_SAFETY_MARGIN_MS - 1)).not.toBeNull();
    expect(getCachedResolvedStream('q', NOW + DEFAULT_TTL_MS)).toBeNull();
  });

  it('does not cache local files', () => {
    // Already on disk; the locker owns that lifetime and it has no expiry to respect.
    cacheResolvedStream('q', stream('file:///data/user/0/app/cache/track.m4a'), NOW);
    expect(getCachedResolvedStream('q', NOW)).toBeNull();
  });

  it('ignores empty and missing results', () => {
    cacheResolvedStream('q', null, NOW);
    cacheResolvedStream('q', stream('   '), NOW);
    cacheResolvedStream('', stream('https://x.test/a'), NOW);
    expect(resolvedStreamCacheSize()).toBe(0);
  });

  it('drops an expired entry rather than leaving it to be re-tested', () => {
    cacheResolvedStream('q', stream('https://x.test/a'), NOW);
    expect(resolvedStreamCacheSize()).toBe(1);
    getCachedResolvedStream('q', NOW + DEFAULT_TTL_MS);
    expect(resolvedStreamCacheSize()).toBe(0);
  });

  it('evicts least-recently-used first so what is being listened to survives', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      cacheResolvedStream(`track-${i}`, stream(`https://x.test/${i}`), NOW + i);
    }
    // Re-read the oldest so it is no longer the least recent.
    getCachedResolvedStream('track-0', NOW + MAX_ENTRIES + 1);
    cacheResolvedStream('overflow', stream('https://x.test/new'), NOW + MAX_ENTRIES + 2);

    expect(resolvedStreamCacheSize()).toBe(MAX_ENTRIES);
    expect(getCachedResolvedStream('track-0', NOW + MAX_ENTRIES + 3)).not.toBeNull();
    expect(getCachedResolvedStream('track-1', NOW + MAX_ENTRIES + 3)).toBeNull();
  });

  it('misses cleanly for a query never seen', () => {
    expect(getCachedResolvedStream('never asked', NOW)).toBeNull();
  });

  it('survives a relaunch', () => {
    // The expensive case this exists for: opening the app and playing what you were just
    // listening to. An in-memory cache is empty exactly then.
    const s = stream('https://x.test/a');
    cacheResolvedStream('persisted', s, NOW);
    reloadResolvedStreamCache();
    expect(getCachedResolvedStream('persisted', NOW)?.uri).toBe(s.uri);
  });

  it('starts cold rather than throwing on a corrupt store', () => {
    globalThis.localStorage.setItem('sandbox_resolved_stream_cache_v1', '{not json');
    reloadResolvedStreamCache();
    expect(getCachedResolvedStream('anything', NOW)).toBeNull();
  });
});
