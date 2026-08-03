import { describe, expect, it } from 'vitest';
import {
  absoluteSeekFromChapter,
  chapterIndexAt,
  marksFromDurations,
  normaliseMarks,
  resolveChapterWindow,
  type ChapterMark,
} from './chapterScrubber';

/** Three chapters of ten minutes each, half an hour in total. */
const BOOK: ChapterMark[] = [
  { startSeconds: 0, title: 'One' },
  { startSeconds: 600, title: 'Two' },
  { startSeconds: 1_200, title: 'Three' },
];
const BOOK_LENGTH = 1_800;

describe('normaliseMarks', () => {
  it('sorts by offset', () => {
    const out = normaliseMarks([{ startSeconds: 90 }, { startSeconds: 10 }, { startSeconds: 50 }]);
    expect(out.map((m) => m.startSeconds)).toEqual([10, 50, 90]);
  });

  it('drops offsets that cannot be true', () => {
    const out = normaliseMarks([
      { startSeconds: -5 },
      { startSeconds: Number.NaN },
      { startSeconds: 12 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops a second mark at the same second, which would have no width to scrub', () => {
    const out = normaliseMarks([{ startSeconds: 60, title: 'Kept' }, { startSeconds: 60 }]);
    expect(out).toEqual([{ startSeconds: 60, title: 'Kept' }]);
  });
});

describe('chapterIndexAt', () => {
  it('finds the chapter containing a position', () => {
    expect(chapterIndexAt(BOOK, 0)).toBe(0);
    expect(chapterIndexAt(BOOK, 599)).toBe(0);
    expect(chapterIndexAt(BOOK, 600)).toBe(1);
    expect(chapterIndexAt(BOOK, 1_500)).toBe(2);
  });

  it('counts unlabelled front matter as the first chapter', () => {
    expect(chapterIndexAt([{ startSeconds: 30 }, { startSeconds: 90 }], 4)).toBe(0);
  });

  it('reports -1 with nothing to search', () => {
    expect(chapterIndexAt([], 10)).toBe(-1);
  });
});

describe('resolveChapterWindow', () => {
  it('scopes the bar to the chapter rather than the book', () => {
    const w = resolveChapterWindow({
      positionSeconds: 750,
      durationSeconds: BOOK_LENGTH,
      chapters: BOOK,
    });
    expect(w).not.toBeNull();
    expect(w!.index).toBe(1);
    expect(w!.count).toBe(3);
    expect(w!.title).toBe('Two');
    expect(w!.durationSeconds).toBe(600);
    // 150 seconds into chapter two, not 750 seconds into a half-hour bar.
    expect(w!.positionSeconds).toBe(150);
    expect(w!.remainingSeconds).toBe(450);
  });

  it('keeps whole-book progress as a number to read, not a target to aim at', () => {
    const w = resolveChapterWindow({
      positionSeconds: 450,
      durationSeconds: BOOK_LENGTH,
      chapters: BOOK,
    });
    expect(w!.overallPercent).toBeCloseTo(25, 5);
    expect(w!.overallRemainingSeconds).toBe(1_350);
  });

  it('takes the last chapter to the end of the book', () => {
    const w = resolveChapterWindow({
      positionSeconds: 1_300,
      durationSeconds: BOOK_LENGTH,
      chapters: BOOK,
    });
    expect(w!.durationSeconds).toBe(600);
    expect(w!.positionSeconds).toBe(100);
  });

  it('declines when the asset is one chapter, where the ordinary bar already fits', () => {
    expect(
      resolveChapterWindow({
        positionSeconds: 30,
        durationSeconds: 600,
        chapters: [{ startSeconds: 0, title: 'All of it' }],
      }),
    ).toBeNull();
    expect(
      resolveChapterWindow({ positionSeconds: 30, durationSeconds: 600, chapters: [] }),
    ).toBeNull();
  });

  it('declines in the last chapter of an asset with no known length', () => {
    // Its end is the asset's end, and drawing a bar to an edge we are guessing at is the exact
    // failure this module exists to remove.
    expect(
      resolveChapterWindow({ positionSeconds: 1_300, durationSeconds: 0, chapters: BOOK }),
    ).toBeNull();
  });

  it('still scopes earlier chapters when the total length is unknown', () => {
    const w = resolveChapterWindow({ positionSeconds: 700, durationSeconds: 0, chapters: BOOK });
    expect(w!.index).toBe(1);
    expect(w!.durationSeconds).toBe(600);
    // Nothing honest to say about the whole book, so it says nothing.
    expect(w!.overallPercent).toBe(0);
    expect(w!.overallRemainingSeconds).toBe(0);
  });

  it('clamps a position past the end of the book instead of drawing past the track', () => {
    const w = resolveChapterWindow({
      positionSeconds: 1_900,
      durationSeconds: BOOK_LENGTH,
      chapters: BOOK,
    });
    expect(w!.positionSeconds).toBe(600);
    expect(w!.remainingSeconds).toBe(0);
  });

  it('survives a position that is not a number', () => {
    const w = resolveChapterWindow({
      positionSeconds: Number.NaN,
      durationSeconds: BOOK_LENGTH,
      chapters: BOOK,
    });
    expect(w!.index).toBe(0);
    expect(w!.positionSeconds).toBe(0);
  });

  it('normalises unless told the marks are already clean', () => {
    const scrambled = [BOOK[2]!, BOOK[0]!, BOOK[1]!];
    const w = resolveChapterWindow({
      positionSeconds: 750,
      durationSeconds: BOOK_LENGTH,
      chapters: scrambled,
    });
    expect(w!.title).toBe('Two');
  });
});

describe('absoluteSeekFromChapter', () => {
  const window = resolveChapterWindow({
    positionSeconds: 750,
    durationSeconds: BOOK_LENGTH,
    chapters: BOOK,
  })!;

  it('translates a scrub in the chapter into a position in the book', () => {
    expect(absoluteSeekFromChapter(window, 0)).toBe(600);
    expect(absoluteSeekFromChapter(window, 300)).toBe(900);
  });

  it('stops at the chapter edge rather than silently changing chapter', () => {
    expect(absoluteSeekFromChapter(window, 5_000)).toBe(1_200);
    expect(absoluteSeekFromChapter(window, -60)).toBe(600);
  });
});

describe('marksFromDurations', () => {
  it('lays one-file-per-chapter books out on a single timeline', () => {
    expect(
      marksFromDurations([
        { durationSeconds: 600, title: 'One' },
        { durationSeconds: 900, title: 'Two' },
        { durationSeconds: 300, title: 'Three' },
      ]),
    ).toEqual([
      { startSeconds: 0, title: 'One' },
      { startSeconds: 600, title: 'Two' },
      { startSeconds: 1_500, title: 'Three' },
    ]);
  });

  it('treats a missing duration as nothing rather than as NaN down the whole list', () => {
    const marks = marksFromDurations([
      { durationSeconds: Number.NaN },
      { durationSeconds: 120 },
      { durationSeconds: 60 },
    ]);
    expect(marks.map((m) => m.startSeconds)).toEqual([0, 0, 120]);
  });
});
