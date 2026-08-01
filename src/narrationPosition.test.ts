import { describe, expect, it } from 'vitest';
import type { NarrationChunk } from './documentNarration';
import {
  RESUME_REWIND_AFTER_MS,
  RESUME_REWIND_CHARS,
  chunkForOffset,
  chunkStartOffsets,
  offsetForChunk,
  resumeOffset,
} from './narrationPosition';

const chunk = (text: string): NarrationChunk => ({ text, section: 'Doc', isHeading: false });

describe('offsets', () => {
  const chunks = [chunk('aaaa'), chunk('bbbbbb'), chunk('cc')];

  it('accumulates offsets from chunk lengths', () => {
    expect(chunkStartOffsets(chunks)).toEqual([0, 5, 12]);
  });

  it('round-trips a chunk through its offset', () => {
    for (let i = 0; i < chunks.length; i += 1) {
      expect(chunkForOffset(chunks, offsetForChunk(chunks, i))).toBe(i);
    }
  });

  it('clamps an index past the end rather than throwing', () => {
    expect(offsetForChunk(chunks, 99)).toBe(12);
    expect(offsetForChunk(chunks, -5)).toBe(0);
  });

  it('handles an empty document', () => {
    expect(chunkStartOffsets([])).toEqual([]);
    expect(offsetForChunk([], 3)).toBe(0);
    expect(chunkForOffset([], 100)).toBe(0);
  });

  it('lands inside the chunk containing an offset, not the next one', () => {
    // 7 is inside chunk 1, which runs from 5 to 11.
    expect(chunkForOffset(chunks, 7)).toBe(1);
  });

  it('resumes at the last chunk rather than restarting when the offset is past the end', () => {
    expect(chunkForOffset(chunks, 10_000)).toBe(2);
  });

  /*
   * The reason this module exists: the same text, cut differently, must resume in the same place.
   */
  it('survives the document being re-chunked', () => {
    const coarse = [chunk('aaaaaaaaaa'), chunk('bbbbbbbbbb')];
    const fine = [chunk('aaaaa'), chunk('aaaa'), chunk('bbbbb'), chunk('bbbb')];
    // Saved while reading the second half of the document under the coarse chunking.
    const saved = offsetForChunk(coarse, 1);
    // Under the fine chunking that offset must still land in the b-text, not back in the a-text.
    const resumed = chunkForOffset(fine, saved);
    expect(fine[resumed]!.text.startsWith('b')).toBe(true);
  });
});

describe('resumeOffset', () => {
  const now = 1_000_000_000;

  it('resumes exactly where it stopped when you come straight back', () => {
    expect(resumeOffset(5000, now - 1000, now)).toBe(5000);
  });

  it('rewinds a little after a long gap, so you land before where you left off', () => {
    const out = resumeOffset(5000, now - RESUME_REWIND_AFTER_MS - 1, now);
    expect(out).toBe(5000 - RESUME_REWIND_CHARS);
  });

  it('never rewinds past the start', () => {
    expect(resumeOffset(50, now - RESUME_REWIND_AFTER_MS - 1, now)).toBe(0);
  });

  it('treats the very beginning as the beginning', () => {
    expect(resumeOffset(0, now - 10_000_000, now)).toBe(0);
    expect(resumeOffset(Number.NaN, now, now)).toBe(0);
  });
});
