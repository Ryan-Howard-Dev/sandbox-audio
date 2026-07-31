// @vitest-environment jsdom
/**
 * Randomised invariant checks for the modules added this session.
 *
 * The per-module tests assert known cases; this asserts properties that must hold for *any* input,
 * which is where the cases nobody thought of live. Seeded so a failure is reproducible — an
 * unreproducible fuzz failure is worse than no fuzz test, because it cannot be fixed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fuseRankedLists } from './rankFusion';
import {
  EXPIRY_SAFETY_MARGIN_MS,
  MAX_ENTRIES,
  cacheResolvedStream,
  clearResolvedStreamCache,
  getCachedResolvedStream,
  parseStreamExpiry,
  resolvedStreamCacheSize,
} from './resolvedStreamCache';
import { prefetchQueueIndices } from './trackPrefetch';
import { titleTokensBeyondQuery } from './searchCatalog';
import { AUDIOBOOK_CLARITY, PODCAST_CLARITY, highPassHzForRoute } from './speechClarity';

/** Deterministic PRNG — mulberry32. Same seed, same run, every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITERATIONS = 300;

describe('stress: fuseRankedLists', () => {
  it('never loses, duplicates or misorders an item across random list shapes', () => {
    const rand = rng(1);
    for (let run = 0; run < ITERATIONS; run++) {
      const listCount = 1 + Math.floor(rand() * 5);
      const universe = 1 + Math.floor(rand() * 12);
      const lists = Array.from({ length: listCount }, (_, li) => ({
        source: `s${li}`,
        items: Array.from({ length: Math.floor(rand() * universe) }, () => ({
          id: `t${Math.floor(rand() * universe)}`,
        })),
        weight: rand() < 0.3 ? rand() * 3 : undefined,
      }));

      const fused = fuseRankedLists(lists, (t) => t.id);
      const ids = fused.map((r) => r.item.id);

      // No duplicates: the identity function is the only thing preventing two rows for one track.
      expect(new Set(ids).size).toBe(ids.length);

      // Nothing invented, nothing dropped (bar zero-weight lists, which are excluded by design).
      const expected = new Set(
        lists.filter((l) => l.weight === undefined || l.weight > 0).flatMap((l) => l.items.map((i) => i.id)),
      );
      expect(new Set(ids)).toEqual(expected);

      // Scores must be non-increasing, or the sort contract is broken.
      for (let i = 1; i < fused.length; i++) {
        expect(fused[i - 1]!.score).toBeGreaterThanOrEqual(fused[i]!.score);
      }

      for (const row of fused) {
        expect(row.score).toBeGreaterThan(0);
        expect(row.bestRank).toBeGreaterThanOrEqual(1);
        expect(row.sources.length).toBeGreaterThanOrEqual(1);
        // Sources must be unique — a list appearing twice would double-count consensus.
        expect(new Set(row.sources).size).toBe(row.sources.length);
      }
    }
  });

  it('is deterministic for identical input', () => {
    const lists = [
      { source: 'a', items: [{ id: 'x' }, { id: 'y' }] },
      { source: 'b', items: [{ id: 'y' }, { id: 'z' }] },
    ];
    const first = fuseRankedLists(lists, (t) => t.id).map((r) => r.item.id);
    for (let i = 0; i < 20; i++) {
      expect(fuseRankedLists(lists, (t) => t.id).map((r) => r.item.id)).toEqual(first);
    }
  });

  it('respects limit without changing the order of what survives', () => {
    const rand = rng(2);
    for (let run = 0; run < 100; run++) {
      const lists = [
        { source: 'a', items: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` })) },
        { source: 'b', items: Array.from({ length: 10 }, () => ({ id: `a${Math.floor(rand() * 10)}` })) },
      ];
      const full = fuseRankedLists(lists, (t) => t.id).map((r) => r.item.id);
      const limit = 1 + Math.floor(rand() * 10);
      expect(fuseRankedLists(lists, (t) => t.id, { limit })).toHaveLength(
        Math.min(limit, full.length),
      );
      expect(fuseRankedLists(lists, (t) => t.id, { limit }).map((r) => r.item.id)).toEqual(
        full.slice(0, limit),
      );
    }
  });
});

describe('stress: resolvedStreamCache', () => {
  beforeEach(() => clearResolvedStreamCache());

  it('never hands back a stream inside the safety margin, whatever the expiry', () => {
    const rand = rng(3);
    const now = 1_800_000_000_000;
    for (let run = 0; run < ITERATIONS; run++) {
      clearResolvedStreamCache();
      // Expiries spanning the past, the margin, and the far future.
      const offsetMs = Math.floor((rand() - 0.35) * 4 * 60 * 60 * 1000);
      const uri = `https://x.test/a?expire=${Math.floor((now + offsetMs) / 1000)}`;
      cacheResolvedStream('q', { uri, bitrate: 128, format: 'm4a' }, now);
      const hit = getCachedResolvedStream('q', now);
      if (hit) {
        const expiry = parseStreamExpiry(hit.uri, now);
        expect(expiry).not.toBeNull();
        // The whole point: a returned URL must outlive the margin.
        expect(expiry! - EXPIRY_SAFETY_MARGIN_MS).toBeGreaterThan(now);
      }
    }
  });

  it('stays bounded no matter how much is written', () => {
    const rand = rng(4);
    const now = 1_800_000_000_000;
    for (let i = 0; i < MAX_ENTRIES * 3; i++) {
      cacheResolvedStream(`k${i}`, { uri: `https://x.test/${rand()}`, bitrate: 1, format: 'm4a' }, now + i);
      expect(resolvedStreamCacheSize()).toBeLessThanOrEqual(MAX_ENTRIES);
    }
  });

  it('never throws on hostile input', () => {
    const now = Date.now();
    const nasty = [
      '',
      '   ',
      'https://x.test/a?expire=',
      'https://x.test/a?expire=abc',
      'https://x.test/a?expire=-1',
      'https://x.test/a?expire=99999999999999999999',
      `https://x.test/a?expire=${'9'.repeat(400)}`,
      'not a url at all',
      'file:///local/file.m4a',
      `https://x.test/a?expire=${Number.MAX_SAFE_INTEGER}`,
    ];
    for (const uri of nasty) {
      expect(() => parseStreamExpiry(uri, now)).not.toThrow();
      expect(() => cacheResolvedStream('k', { uri, bitrate: 0, format: '' }, now)).not.toThrow();
      expect(() => getCachedResolvedStream('k', now)).not.toThrow();
    }
  });

  it('parseStreamExpiry never returns a value at or before now', () => {
    const rand = rng(5);
    const now = 1_800_000_000_000;
    for (let run = 0; run < ITERATIONS; run++) {
      const secs = Math.floor(rand() * 4_000_000_000);
      const got = parseStreamExpiry(`https://x.test/a?expire=${secs}`, now);
      if (got !== null) expect(got).toBeGreaterThan(now);
    }
  });
});

describe('stress: prefetchQueueIndices', () => {
  it('holds its invariants for every queue shape', () => {
    const rand = rng(6);
    for (let run = 0; run < ITERATIONS; run++) {
      const length = Math.floor(rand() * 12);
      const index = Math.floor(rand() * Math.max(1, length));
      const repeat = rand() < 0.5 ? 'all' : 'off';
      const ahead = Math.floor(rand() * 8);
      const indices = prefetchQueueIndices(index, length, repeat, ahead);

      // Never re-fetch what is already playing — that is wasted network at the worst moment.
      expect(indices).not.toContain(index);
      // No duplicates, all in range.
      expect(new Set(indices).size).toBe(indices.length);
      for (const i of indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(Math.max(length, 1));
      }
      // Never more than the lookahead plus the single previous track.
      expect(indices.length).toBeLessThanOrEqual(ahead + 1);
      // Cannot exceed what the queue actually holds.
      expect(indices.length).toBeLessThanOrEqual(Math.max(0, length - 1));
    }
  });
});

describe('stress: titleTokensBeyondQuery', () => {
  it('is non-negative and never counts a token the query already contains', () => {
    const rand = rng(7);
    const words = ['humble', 'remix', 'mixed', 'kendrick', 'lamar', 'live', 'karaoke', 'the', '2024'];
    const pick = (n: number) =>
      Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ');

    for (let run = 0; run < ITERATIONS; run++) {
      const title = pick(1 + Math.floor(rand() * 5));
      const query = pick(1 + Math.floor(rand() * 4));
      const artist = pick(Math.floor(rand() * 3));
      const extras = titleTokensBeyondQuery(title, query, artist);
      expect(extras).toBeGreaterThanOrEqual(0);
      // A title cannot have more unmatched words than it has words.
      expect(extras).toBeLessThanOrEqual(title.split(/\s+/).filter(Boolean).length);
      // Asking for the exact title leaves nothing unmatched.
      expect(titleTokensBeyondQuery(title, title, artist)).toBe(0);
    }
  });

  it('never throws on hostile strings', () => {
    const nasty = ['', '   ', '()[]{}', '💿🎵', 'a'.repeat(5000), ' ', '...---...'];
    for (const a of nasty) {
      for (const b of nasty) {
        expect(() => titleTokensBeyondQuery(a, b, a)).not.toThrow();
      }
    }
  });
});

describe('stress: highPassHzForRoute', () => {
  it('never returns below the profile corner, for any route', () => {
    const routes = [
      'phone-speaker',
      'wired-headphones',
      'bluetooth',
      'tv-hdmi',
      'laptop',
      'pc-speaker',
      'line-out',
      null,
      undefined,
    ] as const;
    for (const profile of [AUDIOBOOK_CLARITY, PODCAST_CLARITY]) {
      for (const route of routes) {
        const hz = highPassHzForRoute(profile, route);
        // Lowering the corner would let through the rumble the profile exists to remove.
        expect(hz).toBeGreaterThanOrEqual(profile.highPassHz);
        // And it must never climb into the vocal band.
        expect(hz).toBeLessThanOrEqual(250);
      }
    }
  });
});
