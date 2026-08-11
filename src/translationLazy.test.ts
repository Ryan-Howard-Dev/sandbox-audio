import { describe, expect, it } from 'vitest';
import {
  chunkIndexForOffset,
  isWaitingOnVisible,
  nextTranslationBatch,
  pruneTranslations,
} from './translationLazy';

const none = new Set<number>();

const input = (over: Partial<Parameters<typeof nextTranslationBatch>[0]> = {}) => ({
  total: 50,
  index: 10,
  done: none,
  inFlight: none,
  ...over,
});

describe('nextTranslationBatch', () => {
  it('starts at the passage in view, not at the far end of the window', () => {
    // A batch that begins six passages ahead fills the wrong end while the visible half is blank.
    expect(nextTranslationBatch(input(), { batch: 3 })[0]).toBe(10);
  });

  it('works outward from the reader, forward before backward', () => {
    expect(nextTranslationBatch(input(), { batch: 4 })).toEqual([10, 11, 9, 12]);
  });

  it('never asks twice for something already translated', () => {
    const batch = nextTranslationBatch(input({ done: new Set([10, 11]) }), { batch: 3 });
    expect(batch).not.toContain(10);
    expect(batch).not.toContain(11);
  });

  it('never asks again for something already in flight', () => {
    /*
     * The failure this whole module exists for: a fast scroll firing a request per passage.
     *
     * Order is by distance from the reader before direction, so with 10-12 already asked for the
     * next nearest is 9, then 8, then 13. Filling the forward window first would leave a reader
     * who glanced up a paragraph staring at a blank half until six passages ahead had finished.
     */
    const batch = nextTranslationBatch(input({ inFlight: new Set([10, 11, 12]) }), { batch: 3 });
    expect(batch).toEqual([9, 8, 13]);
  });

  it('leaves alone what was refused for good', () => {
    const batch = nextTranslationBatch(input({ refused: new Set([10]) }), { batch: 2 });
    expect(batch).not.toContain(10);
  });

  it('caps the batch however much is missing', () => {
    expect(nextTranslationBatch(input(), { batch: 2 })).toHaveLength(2);
  });

  it('stays inside the chapter at both ends', () => {
    const atStart = nextTranslationBatch(input({ index: 0 }), { batch: 8 });
    expect(Math.min(...atStart)).toBeGreaterThanOrEqual(0);

    const atEnd = nextTranslationBatch(input({ index: 49 }), { batch: 8 });
    expect(Math.max(...atEnd)).toBeLessThanOrEqual(49);
  });

  it('asks for nothing once the window is full', () => {
    const done = new Set<number>();
    for (let i = 0; i < 50; i += 1) done.add(i);
    expect(nextTranslationBatch(input({ done }))).toEqual([]);
  });

  it('asks for nothing when there is nothing there', () => {
    expect(nextTranslationBatch(input({ total: 0 }))).toEqual([]);
  });

  it('does not run away when the position is nonsense', () => {
    expect(() => nextTranslationBatch(input({ index: -5 }))).not.toThrow();
    expect(() => nextTranslationBatch(input({ index: 9999 }))).not.toThrow();
    expect(nextTranslationBatch(input({ index: 9999 })).every((i) => i < 50)).toBe(true);
  });

  it('translates a little behind as well, for a reader glancing up', () => {
    const batch = nextTranslationBatch(input({ done: new Set([10, 11, 12, 13, 14, 15, 16]) }), {
      batch: 3,
    });
    expect(batch).toContain(9);
  });
});

describe('isWaitingOnVisible', () => {
  it('is true only while the passage in view has nothing to show', () => {
    expect(isWaitingOnVisible(input())).toBe(true);
    expect(isWaitingOnVisible(input({ done: new Set([10]) }))).toBe(false);
  });

  it('is false for a passage that will never arrive, so the spinner stops', () => {
    expect(isWaitingOnVisible(input({ refused: new Set([10]) }))).toBe(false);
  });

  it('is false when there is nothing to read', () => {
    expect(isWaitingOnVisible(input({ total: 0 }))).toBe(false);
  });
});

describe('pruneTranslations', () => {
  it('keeps what is near and drops what is far', () => {
    const cache = new Map<number, string>();
    for (let i = 0; i < 500; i += 1) cache.set(i, `t${i}`);
    const kept = pruneTranslations(cache, 250, 10);
    expect(kept.has(250)).toBe(true);
    expect(kept.has(240)).toBe(true);
    expect(kept.has(200)).toBe(false);
    expect(kept.size).toBe(21);
  });

  it('keeps generously, because re-translating a scroll back is worse than the memory', () => {
    const cache = new Map([[0, 'a'], [59, 'b']]);
    expect(pruneTranslations(cache, 0).size).toBe(2);
  });
});

describe('chunkIndexForOffset', () => {
  const lengths = [100, 50, 200, 25];

  it('finds the passage holding a character offset', () => {
    expect(chunkIndexForOffset(lengths, 0)).toBe(0);
    expect(chunkIndexForOffset(lengths, 99)).toBe(0);
    expect(chunkIndexForOffset(lengths, 100)).toBe(1);
    expect(chunkIndexForOffset(lengths, 149)).toBe(1);
    expect(chunkIndexForOffset(lengths, 150)).toBe(2);
  });

  it('clamps an offset past the end rather than returning nothing', () => {
    expect(chunkIndexForOffset(lengths, 99999)).toBe(3);
  });

  it('falls back to the stored index when there is no offset', () => {
    // Documents are re-chunked on open, so a stored chunk index is a hint and the offset is the
    // authority. With no offset the hint is all there is.
    expect(chunkIndexForOffset(lengths, undefined, 2)).toBe(2);
    expect(chunkIndexForOffset(lengths, undefined, 99)).toBe(3);
  });

  it('survives an empty document', () => {
    expect(chunkIndexForOffset([], 10)).toBe(0);
  });
});
