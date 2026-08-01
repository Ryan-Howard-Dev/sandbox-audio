import { describe, expect, it } from 'vitest';
import {
  LONG_GAP_MS,
  SHORT_GAP_MS,
  resumeAtSeconds,
  rewindPolicyFor,
  rewindSecondsFor,
} from './resumeRewind';

const NOW = 1_700_000_000_000;

describe('rewindSecondsFor', () => {
  it('never rewinds music', () => {
    expect(rewindSecondsFor('music', LONG_GAP_MS * 10)).toBe(0);
    expect(rewindPolicyFor('music')).toBeNull();
  });

  it('never rewinds spoken text in seconds, which counts in characters', () => {
    expect(rewindSecondsFor('spoken-text', LONG_GAP_MS * 10)).toBe(0);
  });

  it('does not rewind when you barely left', () => {
    expect(rewindSecondsFor('podcast', 0)).toBe(0);
    expect(rewindSecondsFor('audiobook', SHORT_GAP_MS - 1)).toBe(0);
  });

  it('rewinds a little after a short absence', () => {
    expect(rewindSecondsFor('podcast', SHORT_GAP_MS)).toBe(3);
    expect(rewindSecondsFor('audiobook', SHORT_GAP_MS)).toBe(10);
  });

  it('rewinds further after a long one', () => {
    expect(rewindSecondsFor('podcast', LONG_GAP_MS)).toBe(5);
    expect(rewindSecondsFor('audiobook', LONG_GAP_MS + 1)).toBe(15);
  });

  /*
   * Losing your place in a thirty hour novel costs more than losing it in a news episode, and
   * prose needs more run-up to re-enter than two people talking.
   */
  it('always rewinds an audiobook further than a podcast', () => {
    for (const away of [SHORT_GAP_MS, LONG_GAP_MS, LONG_GAP_MS * 5]) {
      expect(rewindSecondsFor('audiobook', away)).toBeGreaterThan(
        rewindSecondsFor('podcast', away),
      );
    }
  });

  it('does not throw on a nonsense gap', () => {
    expect(rewindSecondsFor('podcast', Number.NaN)).toBe(0);
    expect(rewindSecondsFor('podcast', -5000)).toBe(0);
  });
});

describe('resumeAtSeconds', () => {
  it('resumes exactly where you stopped if you come straight back', () => {
    expect(resumeAtSeconds(3600, NOW - 1000, 'audiobook', NOW)).toBe(3600);
  });

  it('lands before where you left off after a long absence', () => {
    expect(resumeAtSeconds(3600, NOW - LONG_GAP_MS, 'audiobook', NOW)).toBe(3585);
    expect(resumeAtSeconds(3600, NOW - LONG_GAP_MS, 'podcast', NOW)).toBe(3595);
  });

  it('never rewinds past the start', () => {
    expect(resumeAtSeconds(4, NOW - LONG_GAP_MS, 'audiobook', NOW)).toBe(0);
  });

  it('treats the very beginning as the beginning', () => {
    expect(resumeAtSeconds(0, NOW - LONG_GAP_MS, 'audiobook', NOW)).toBe(0);
    expect(resumeAtSeconds(Number.NaN, NOW, 'audiobook', NOW)).toBe(0);
  });

  /*
   * Positions saved before timestamps existed have no age. Guessing one would rewind every stored
   * position on the first launch after an update, which would look like the app losing places.
   */
  it('honours a position saved before timestamps existed', () => {
    expect(resumeAtSeconds(3600, undefined, 'audiobook', NOW)).toBe(3600);
  });

  it('leaves music alone however long you were away', () => {
    expect(resumeAtSeconds(120, NOW - LONG_GAP_MS * 30, 'music', NOW)).toBe(120);
  });
});
