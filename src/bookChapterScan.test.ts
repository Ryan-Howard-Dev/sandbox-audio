import { describe, expect, it, vi } from 'vitest';
import {
  MAX_KEYWORD_PASS_FRACTION,
  isScanRetryable,
  marksFromScan,
  scanBookChapters,
  type ChapterScanDeps,
  type ScannedSilences,
} from './bookChapterScan';
import type { KeywordHit } from './spokenChapterDetect';

const URI = 'content://media/external/audio/media/42';

/** Four chapters at ten minute intervals, each behind a three second pause. */
const SCANNED: ScannedSilences = {
  silences: [
    { startSeconds: 597, endSeconds: 600 },
    { startSeconds: 1_197, endSeconds: 1_200 },
    { startSeconds: 1_797, endSeconds: 1_800 },
  ],
  durationSeconds: 2_400,
  frameSeconds: 0.1,
};

const HITS: KeywordHit[] = [
  { atSeconds: 1, keyword: 'chapter', score: 0.9 },
  { atSeconds: 602, keyword: 'chapter', score: 0.9 },
  { atSeconds: 1_202, keyword: 'chapter', score: 0.9 },
  { atSeconds: 1_802, keyword: 'chapter', score: 0.9 },
];

function deps(over: Partial<ChapterScanDeps> = {}): ChapterScanDeps {
  return {
    scanSilences: vi.fn(async () => SCANNED),
    spotKeywords: vi.fn(async () => HITS),
    ...over,
  };
}

describe('a book whose chapters are announced', () => {
  it('finds them', async () => {
    const out = await scanBookChapters(URI, deps());
    expect(out.status).toBe('chapters');
    if (out.status !== 'chapters') return;
    expect(out.chapters.map((c) => c.startSeconds)).toEqual([0, 600, 1_200, 1_800]);
  });

  it('reports how little of the book the spotter had to hear', async () => {
    const out = await scanBookChapters(URI, deps());
    if (out.status !== 'chapters') throw new Error('expected chapters');
    // Four six-second windows out of forty minutes.
    expect(out.scannedFraction).toBeLessThan(0.02);
  });

  it('asks the spotter only at the pauses, never for the whole book', async () => {
    const d = deps();
    await scanBookChapters(URI, d);
    const windows = (d.spotKeywords as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Array<{
      startSeconds: number;
    }>;
    expect(windows.map((w) => w.startSeconds)).toEqual([0, 600, 1_200, 1_800]);
  });
});

describe('the distinction that matters: none versus unavailable', () => {
  /*
   * These two are the whole reason this module exists. Collapsing them into an empty list is what
   * hid the getLong bug: every ranged read returned byte zero, found no chapter table, and
   * reported a book with no chapters — indistinguishable from the truthful answer.
   */

  it("says 'none' when it listened and the book announces nothing", async () => {
    const d = deps({ spotKeywords: vi.fn(async () => []) });
    expect((await scanBookChapters(URI, d)).status).toBe('none');
  });

  it("says 'none' when the recording has no long pauses to examine", async () => {
    const d = deps({
      scanSilences: vi.fn(async () => ({ ...SCANNED, silences: [] })),
    });
    const out = await scanBookChapters(URI, d);
    expect(out.status).toBe('none');
    // And it never paid for a keyword pass to learn that.
    expect(d.spotKeywords).not.toHaveBeenCalled();
  });

  it("says 'unavailable' when there is no scanner on this platform", async () => {
    const d = deps({ scanSilences: vi.fn(async () => null) });
    const out = await scanBookChapters(URI, d);
    expect(out).toEqual({ status: 'unavailable', reason: 'no-scanner' });
  });

  it("says 'unavailable' when the spotter has no model to run", async () => {
    // Null is "could not listen". An empty array is "listened, heard nothing".
    const d = deps({ spotKeywords: vi.fn(async () => null) });
    const out = await scanBookChapters(URI, d);
    expect(out).toEqual({ status: 'unavailable', reason: 'no-model' });
  });

  it("says 'unavailable' when the file will not decode", async () => {
    const d = deps({
      scanSilences: vi.fn(async () => {
        throw new Error('codec refused');
      }),
    });
    expect(await scanBookChapters(URI, d)).toEqual({
      status: 'unavailable',
      reason: 'decode-failed',
    });
  });

  it('treats a thrown spotter as a missing model rather than as silence', async () => {
    const d = deps({
      spotKeywords: vi.fn(async () => {
        throw new Error('model load failed');
      }),
    });
    expect((await scanBookChapters(URI, d)).status).toBe('unavailable');
  });
});

describe('refusing work that is not worth it', () => {
  it('declines when the pauses are so frequent the saving has gone', async () => {
    /*
     * The point of scanning pauses first is that the spotter hears minutes rather than hours. A
     * halting speaker or a badly edited file produces candidates everywhere, and grinding through
     * most of a long book to find nothing is worse than saying so.
     */
    const many = Array.from({ length: 200 }, (_, i) => ({
      startSeconds: i * 10,
      endSeconds: i * 10 + 3,
    }));
    const d = deps({
      scanSilences: vi.fn(async () => ({ silences: many, durationSeconds: 2_000, frameSeconds: 0.1 })),
    });
    const out = await scanBookChapters(URI, d);
    expect(out).toEqual({ status: 'unavailable', reason: 'not-worth-it' });
    expect(d.spotKeywords).not.toHaveBeenCalled();
  });

  it('honours a caller that will pay more', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      startSeconds: i * 10,
      endSeconds: i * 10 + 3,
    }));
    const d = deps({
      scanSilences: vi.fn(async () => ({ silences: many, durationSeconds: 2_000, frameSeconds: 0.1 })),
      spotKeywords: vi.fn(async () => []),
    });
    const out = await scanBookChapters(URI, d, { maxKeywordPassFraction: 1 });
    expect(out.status).toBe('none');
    expect(d.spotKeywords).toHaveBeenCalled();
  });

  it('has a default that admits most books and refuses the pathological ones', () => {
    expect(MAX_KEYWORD_PASS_FRACTION).toBeGreaterThan(0.05);
    expect(MAX_KEYWORD_PASS_FRACTION).toBeLessThan(0.5);
  });

  it('declines an empty uri without touching the device', async () => {
    const d = deps();
    expect(await scanBookChapters('  ', d)).toEqual({
      status: 'unavailable',
      reason: 'decode-failed',
    });
    expect(d.scanSilences).not.toHaveBeenCalled();
  });
});

describe('marksFromScan', () => {
  it('turns a result into marks the scrubber can use', async () => {
    const out = await scanBookChapters(URI, deps());
    expect(marksFromScan(out).map((m) => m.startSeconds)).toEqual([0, 600, 1_200, 1_800]);
  });

  it('leaves them unnamed, because a spotted word is evidence and not a title', async () => {
    const out = await scanBookChapters(URI, deps());
    expect(marksFromScan(out).every((m) => m.title === '')).toBe(true);
  });

  it('gives nothing for either kind of empty answer', () => {
    expect(marksFromScan({ status: 'none' })).toEqual([]);
    expect(marksFromScan({ status: 'unavailable', reason: 'no-model' })).toEqual([]);
  });
});

describe('isScanRetryable', () => {
  it('is worth asking again once a model is installed, or after a bad decode', () => {
    expect(isScanRetryable({ status: 'unavailable', reason: 'no-model' })).toBe(true);
    expect(isScanRetryable({ status: 'unavailable', reason: 'decode-failed' })).toBe(true);
  });

  it('is not worth asking again for anything that will not change', () => {
    expect(isScanRetryable({ status: 'unavailable', reason: 'no-scanner' })).toBe(false);
    expect(isScanRetryable({ status: 'unavailable', reason: 'not-worth-it' })).toBe(false);
    expect(isScanRetryable({ status: 'none' })).toBe(false);
  });
});
