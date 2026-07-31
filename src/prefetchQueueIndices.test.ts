import { describe, expect, it } from 'vitest';
import { PREFETCH_AHEAD, prefetchQueueIndices } from './trackPrefetch';

describe('prefetchQueueIndices', () => {
  it('resolves the tracks ahead, nearest first', () => {
    expect(prefetchQueueIndices(0, 20, 'off', 3)).toEqual([1, 2, 3, /* previous: none */]);
  });

  it('includes the previous track so skipping back is not the slow direction', () => {
    // Back is the skip most likely to be pressed — it is what someone reaches for when they did
    // not want the track that just started, and a forward-only window guaranteed it re-resolved.
    expect(prefetchQueueIndices(5, 20, 'off', 2)).toEqual([6, 7, 4]);
  });

  it('puts the previous track after the ones ahead', () => {
    // One track back against several forward: forward is still the common case.
    const indices = prefetchQueueIndices(5, 20, 'off', 3);
    expect(indices[indices.length - 1]).toBe(4);
  });

  it('has no previous track at the head of a non-repeating queue', () => {
    expect(prefetchQueueIndices(0, 5, 'off', 2)).toEqual([1, 2]);
  });

  it('wraps to the end for the previous track when repeating', () => {
    expect(prefetchQueueIndices(0, 5, 'all', 2)).toEqual([1, 2, 4]);
  });

  it('stops at the end of a non-repeating queue', () => {
    expect(prefetchQueueIndices(3, 5, 'off', 5)).toEqual([4, 2]);
  });

  it('wraps forward when repeating', () => {
    expect(prefetchQueueIndices(3, 5, 'all', 3)).toEqual([4, 0, 1, 2]);
  });

  it('never prefetches the track already playing', () => {
    // Wrapping a short queue can land back on the current index; resolving it again is wasted
    // network at exactly the moment playback needs it.
    for (const current of [0, 1, 2]) {
      expect(prefetchQueueIndices(current, 3, 'all', 5)).not.toContain(current);
    }
    // A single-track repeating queue has nothing else to fetch.
    expect(prefetchQueueIndices(0, 1, 'all', 3)).toEqual([]);
  });

  it('returns nothing for an empty queue', () => {
    expect(prefetchQueueIndices(0, 0, 'off')).toEqual([]);
  });

  it('never repeats an index', () => {
    const indices = prefetchQueueIndices(0, 3, 'all', 10);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('defaults to the module-wide lookahead', () => {
    expect(prefetchQueueIndices(0, 50, 'off')).toHaveLength(PREFETCH_AHEAD);
  });
});
