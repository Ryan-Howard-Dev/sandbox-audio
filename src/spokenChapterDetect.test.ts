import { describe, expect, it } from 'vitest';
import {
  CHAPTER_KEYWORDS,
  DEFAULT_DETECTION,
  detectChapters,
  keywordPassFraction,
  keywordWindows,
  type KeywordHit,
  type SilenceSpan,
} from './spokenChapterDetect';

/** Four chapters at ten minute intervals, each announced two seconds after a three second pause. */
const SILENCES: SilenceSpan[] = [
  { startSeconds: 597, endSeconds: 600 },
  { startSeconds: 1_197, endSeconds: 1_200 },
  { startSeconds: 1_797, endSeconds: 1_800 },
];
const HITS: KeywordHit[] = [
  { atSeconds: 1, keyword: 'chapter', score: 0.9 },
  { atSeconds: 602, keyword: 'chapter', score: 0.9 },
  { atSeconds: 1_202, keyword: 'chapter', score: 0.88 },
  { atSeconds: 1_802, keyword: 'chapter', score: 0.91 },
];
const DURATION = 2_400;

describe('keywordWindows', () => {
  it('listens only after the long pauses', () => {
    const w = keywordWindows(SILENCES);
    expect(w.map((x) => x.startSeconds)).toEqual([0, 600, 1_200, 1_800]);
  });

  it('always includes the opening of the book', () => {
    // Chapter one starts at the beginning with no pause before it. A detector that misses it
    // reports a book whose first chapter is chapter two.
    expect(keywordWindows(SILENCES)[0]!.startSeconds).toBe(0);
  });

  it('ignores pauses short enough to be punctuation', () => {
    const w = keywordWindows([
      { startSeconds: 10, endSeconds: 10.6 },
      { startSeconds: 20, endSeconds: 21.5 },
      { startSeconds: 30, endSeconds: 34 },
    ]);
    expect(w.map((x) => x.startSeconds)).toEqual([0, 34]);
  });

  it('has nothing to listen to when there are no long pauses at all', () => {
    expect(keywordWindows([{ startSeconds: 5, endSeconds: 5.4 }])).toEqual([]);
  });
});

describe('keywordPassFraction', () => {
  it('reports how little of the book the spotter has to hear', () => {
    // The whole point: four six second windows out of forty minutes.
    const fraction = keywordPassFraction(keywordWindows(SILENCES), DURATION);
    expect(fraction).toBeCloseTo(24 / 2_400, 5);
    expect(fraction).toBeLessThan(0.02);
  });

  it('says the saving has gone when pauses are everywhere', () => {
    const many: SilenceSpan[] = Array.from({ length: 100 }, (_, i) => ({
      startSeconds: i * 10,
      endSeconds: i * 10 + 3,
    }));
    expect(keywordPassFraction(keywordWindows(many), 1_000)).toBeGreaterThan(0.5);
  });

  it('treats an unknown length as no saving rather than dividing by zero', () => {
    expect(keywordPassFraction([{ startSeconds: 0, endSeconds: 6 }], 0)).toBe(1);
  });
});

describe('detectChapters', () => {
  it('finds a chapter for each announcement', () => {
    const found = detectChapters({ silences: SILENCES, hits: HITS, durationSeconds: DURATION });
    expect(found.map((c) => c.startSeconds)).toEqual([0, 600, 1_200, 1_800]);
  });

  it('starts the chapter at the pause, not at the spoken word', () => {
    /*
     * The narrator says "chapter two" a moment after the chapter begins. Seeking to the word would
     * clip the first syllable of every chapter in the book.
     */
    const found = detectChapters({ silences: SILENCES, hits: HITS, durationSeconds: DURATION });
    expect(found[1]!.startSeconds).toBe(600);
    expect(found[1]!.startSeconds).toBeLessThan(602);
  });

  it('reports nothing from silence alone', () => {
    /*
     * The rule that keeps this honest. Long pauses happen at scene breaks and wherever a narrator
     * took a drink; a list built from them is plausible, wrong, and indistinguishable from a real
     * one until somebody uses it.
     */
    expect(
      detectChapters({ silences: SILENCES, hits: [], durationSeconds: DURATION }),
    ).toEqual([]);
  });

  it('ignores a word the spotter was not sure of', () => {
    const unsure = HITS.map((h) => ({ ...h, score: 0.2 }));
    expect(
      detectChapters({ silences: SILENCES, hits: unsure, durationSeconds: DURATION }),
    ).toEqual([]);
  });

  it('ignores the word said well into the prose', () => {
    // Somebody discussing a chapter is not the start of one.
    const late: KeywordHit[] = [
      { atSeconds: 1, keyword: 'chapter', score: 0.9 },
      { atSeconds: 660, keyword: 'chapter', score: 0.9 },
      { atSeconds: 1_202, keyword: 'chapter', score: 0.9 },
    ];
    const found = detectChapters({ silences: SILENCES, hits: late, durationSeconds: DURATION });
    expect(found.map((c) => c.startSeconds)).toEqual([0, 1_200]);
  });

  it('accepts the other words that open a section', () => {
    const hits: KeywordHit[] = [
      { atSeconds: 1, keyword: 'prologue', score: 0.9 },
      { atSeconds: 602, keyword: 'Chapter', score: 0.9 },
      { atSeconds: 1_802, keyword: 'EPILOGUE', score: 0.9 },
    ];
    const found = detectChapters({ silences: SILENCES, hits, durationSeconds: DURATION });
    expect(found.map((c) => c.keyword)).toEqual(['prologue', 'chapter', 'epilogue']);
  });

  it('ignores a word that opens nothing', () => {
    const hits: KeywordHit[] = [
      { atSeconds: 1, keyword: 'chapter', score: 0.9 },
      { atSeconds: 602, keyword: 'however', score: 0.99 },
      { atSeconds: 1_202, keyword: 'chapter', score: 0.9 },
    ];
    const found = detectChapters({ silences: SILENCES, hits, durationSeconds: DURATION });
    expect(found.map((c) => c.startSeconds)).toEqual([0, 1_200]);
  });

  it('collapses two announcements at the same boundary into one chapter', () => {
    // "Chapter one" then the chapter's own title, both inside the opening line.
    const doubled: KeywordHit[] = [
      { atSeconds: 1, keyword: 'chapter', score: 0.7 },
      { atSeconds: 3, keyword: 'chapter', score: 0.95 },
      { atSeconds: 602, keyword: 'chapter', score: 0.9 },
    ];
    const found = detectChapters({ silences: SILENCES, hits: doubled, durationSeconds: DURATION });
    expect(found).toHaveLength(2);
    expect(found[0]!.startSeconds).toBe(0);
    // Keeps the reading it was more sure of, at the earlier position.
    expect(found[0]!.score).toBe(0.95);
  });

  it('declines when it finds absurdly many, rather than reporting a wrong list', () => {
    const silences: SilenceSpan[] = Array.from({ length: 400 }, (_, i) => ({
      startSeconds: i * 100,
      endSeconds: i * 100 + 3,
    }));
    const hits: KeywordHit[] = silences.map((s) => ({
      atSeconds: s.endSeconds + 1,
      keyword: 'chapter',
      score: 0.9,
    }));
    expect(detectChapters({ silences, hits, durationSeconds: 40_000 })).toEqual([]);
  });

  it('declines a single mark, which is not navigation', () => {
    const found = detectChapters({
      silences: SILENCES,
      hits: [{ atSeconds: 1, keyword: 'chapter', score: 0.9 }],
      durationSeconds: DURATION,
    });
    expect(found).toEqual([]);
  });

  it('discards a hit reported past the end of the book', () => {
    const hits = [...HITS, { atSeconds: DURATION + 500, keyword: 'chapter', score: 0.99 }];
    const found = detectChapters({ silences: SILENCES, hits, durationSeconds: DURATION });
    expect(found).toHaveLength(4);
  });

  it('survives nonsense from the engine', () => {
    const hits: KeywordHit[] = [
      { atSeconds: Number.NaN, keyword: 'chapter', score: 0.9 },
      { atSeconds: -5, keyword: 'chapter', score: 0.9 },
      { atSeconds: 1, keyword: '', score: 0.9 },
      { atSeconds: 602, keyword: 'chapter', score: Number.NaN },
    ];
    expect(detectChapters({ silences: SILENCES, hits, durationSeconds: DURATION })).toEqual([]);
  });

  it('works with no silences at all, from the opening alone', () => {
    // Nothing to attach later hits to, so a single mark, so nothing. Correct rather than clever.
    expect(
      detectChapters({ silences: [], hits: HITS, durationSeconds: DURATION }),
    ).toEqual([]);
  });

  it('keeps every keyword it advertises', () => {
    // The spotter is configured from this list; a word here that detect rejects would be paid for
    // on every book and never used.
    for (const keyword of CHAPTER_KEYWORDS) {
      const found = detectChapters({
        silences: SILENCES,
        hits: [
          { atSeconds: 1, keyword, score: 0.9 },
          { atSeconds: 602, keyword, score: 0.9 },
        ],
        durationSeconds: DURATION,
      });
      expect(found, keyword).toHaveLength(2);
    }
  });

  it('honours a caller that wants different thresholds', () => {
    const strict = { ...DEFAULT_DETECTION, minScore: 0.95 };
    expect(
      detectChapters({ silences: SILENCES, hits: HITS, durationSeconds: DURATION }, strict),
    ).toEqual([]);
  });
});
