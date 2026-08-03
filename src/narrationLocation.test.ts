import { describe, expect, it } from 'vitest';
import type { NarrationChunk } from './documentNarration';
import {
  isUsableRange,
  narrationMetrics,
  narrationProgressPercent,
  resolveNarrationLocation,
  savedOffsetFor,
} from './narrationLocation';
import { chunkForOffset } from './narrationPosition';

function chunk(text: string, isHeading = false): NarrationChunk {
  return { text, section: '', isHeading };
}

/**
 * A heading and two paragraphs of very different lengths — the shape that makes counting passages
 * and counting characters give different answers.
 */
const DOC: NarrationChunk[] = [
  chunk('Chapter One', true),
  chunk('a'.repeat(600)),
  chunk('b'.repeat(200)),
];

describe('narrationMetrics', () => {
  it('measures the document in characters, separators included', () => {
    const m = narrationMetrics(DOC);
    expect(m.starts).toEqual([0, 12, 613]);
    expect(m.length).toBe(813);
  });

  it('copes with an empty document', () => {
    expect(narrationMetrics([])).toEqual({ starts: [], length: 0 });
  });
});

describe('isUsableRange', () => {
  const text = 'Hello there';

  it('accepts a range inside the text', () => {
    expect(isUsableRange({ start: 0, end: 5 }, text)).toBe(true);
  });

  it('rejects a range that runs past the end', () => {
    // An engine that says "Doctor" for "Dr." reports offsets into a string we were never given.
    expect(isUsableRange({ start: 6, end: 99 }, text)).toBe(false);
  });

  it('rejects an empty, inverted, negative or absent range', () => {
    expect(isUsableRange({ start: 3, end: 3 }, text)).toBe(false);
    expect(isUsableRange({ start: 5, end: 2 }, text)).toBe(false);
    expect(isUsableRange({ start: -1, end: 4 }, text)).toBe(false);
    expect(isUsableRange(null, text)).toBe(false);
    expect(isUsableRange(undefined, text)).toBe(false);
  });
});

describe('resolveNarrationLocation', () => {
  it('locates the utterance in document coordinates', () => {
    const loc = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 1 })!;
    expect(loc.utteranceLocator.utteranceIndex).toBe(1);
    expect(loc.utteranceLocator.characterOffset).toBe(12);
    expect(loc.tokenLocator).toBeNull();
  });

  it('locates the token in the same coordinates as the utterance', () => {
    const loc = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 1,
      range: { start: 300, end: 310 },
    })!;
    expect(loc.tokenLocator!.characterOffset).toBe(312);
    expect(loc.tokenLocator!.utteranceIndex).toBe(1);
  });

  it('drops a token the engine reported outside the passage', () => {
    const loc = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 0,
      range: { start: 0, end: 9_000 },
    })!;
    expect(loc.range).toBeNull();
    expect(loc.tokenLocator).toBeNull();
    // The utterance is still a perfectly good location; only the word is unknown.
    expect(loc.utteranceLocator.characterOffset).toBe(0);
  });

  it('carries the surrounding text, capped', () => {
    const loc = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 1, contextChars: 50 })!;
    expect(loc.textBefore).toBe('Chapter One');
    expect(loc.textAfter).toBe('b'.repeat(50));
  });

  it('has nothing before the first passage or after the last', () => {
    expect(resolveNarrationLocation({ chunks: DOC, utteranceIndex: 0 })!.textBefore).toBeNull();
    expect(resolveNarrationLocation({ chunks: DOC, utteranceIndex: 2 })!.textAfter).toBeNull();
  });

  it('takes the tail of what came before, not its beginning', () => {
    // The words immediately before the passage are the ones that give it context.
    const loc = resolveNarrationLocation({
      chunks: [chunk('start MIDDLE end'), chunk('here')],
      utteranceIndex: 1,
      contextChars: 3,
    })!;
    expect(loc.textBefore).toBe('end');
  });

  it('clamps an index left over from a re-chunk rather than blanking the player', () => {
    const loc = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 99 })!;
    expect(loc.utteranceLocator.utteranceIndex).toBe(2);
  });

  it('survives an index that is not a number', () => {
    expect(
      resolveNarrationLocation({ chunks: DOC, utteranceIndex: Number.NaN })!.utteranceLocator
        .utteranceIndex,
    ).toBe(0);
  });

  it('has no location in an empty document', () => {
    expect(resolveNarrationLocation({ chunks: [], utteranceIndex: 0 })).toBeNull();
  });
});

describe('savedOffsetFor', () => {
  it('saves the word being spoken, not the start of the paragraph', () => {
    /*
     * The point of the whole split. Without it, coming back to a six hundred character paragraph
     * you were nearly through starts it again from the top.
     */
    const loc = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 1,
      range: { start: 540, end: 546 },
    })!;
    expect(savedOffsetFor(loc)).toBe(552);
    expect(savedOffsetFor(loc)).toBeGreaterThan(loc.utteranceLocator.characterOffset);
  });

  it('falls back to the passage when no word is known', () => {
    const loc = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 1 })!;
    expect(savedOffsetFor(loc)).toBe(12);
  });

  it('round-trips through the resume path back to the same passage', () => {
    const loc = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 1,
      range: { start: 540, end: 546 },
    })!;
    expect(chunkForOffset(DOC, savedOffsetFor(loc))).toBe(1);
  });
});

describe('narrationProgressPercent', () => {
  it('measures in characters, so a heading is not a whole step', () => {
    /*
     * Counting passages puts the end of the heading at 33% of a document that is 1.5% read. The
     * heading is eleven characters and the paragraphs are eight hundred between them.
     */
    const heading = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 0 })!;
    expect(narrationProgressPercent(heading)).toBeCloseTo(0, 5);

    const second = resolveNarrationLocation({ chunks: DOC, utteranceIndex: 1 })!;
    expect(narrationProgressPercent(second)).toBeCloseTo((12 / 813) * 100, 5);
  });

  it('advances within a passage as the words are spoken', () => {
    // Passage counting cannot do this at all: the bar would sit still for a whole paragraph.
    const early = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 1,
      range: { start: 10, end: 16 },
    })!;
    const late = resolveNarrationLocation({
      chunks: DOC,
      utteranceIndex: 1,
      range: { start: 560, end: 566 },
    })!;
    expect(narrationProgressPercent(late)).toBeGreaterThan(narrationProgressPercent(early));
  });

  it('never leaves the bar', () => {
    for (const index of [0, 1, 2]) {
      const p = narrationProgressPercent(
        resolveNarrationLocation({ chunks: DOC, utteranceIndex: index })!,
      );
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});
