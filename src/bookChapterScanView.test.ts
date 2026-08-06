import { describe, expect, it } from 'vitest';
import { chapterSectionState, type ChapterSectionInput } from './bookChapterScanView';

function input(overrides: Partial<ChapterSectionInput> = {}): ChapterSectionInput {
  return {
    stated: [],
    allowScan: true,
    scannedMarks: [],
    scanning: false,
    offered: false,
    outcome: null,
    scanned: false,
    ...overrides,
  };
}

const MARKS = [{ startSeconds: 0 }, { startSeconds: 600 }];

describe('the book states its own chapters', () => {
  it('shows them, and never asks to go looking', () => {
    // The one thing this must not do: infer over the top of a fact the file already stated.
    expect(chapterSectionState(input({ stated: MARKS })).kind).toBe('stated');
    expect(chapterSectionState(input({ stated: MARKS, offered: true })).kind).toBe('stated');
    expect(
      chapterSectionState(input({ stated: MARKS, scannedMarks: MARKS })).kind,
    ).toBe('stated');
  });

  it('draws nothing at all while the file is still being read', () => {
    // A heading over an empty list reads as breakage, and every book would flash one.
    expect(chapterSectionState(input({ stated: null })).kind).toBe('loading');
    expect(chapterSectionState(input({ stated: null, offered: true })).kind).toBe('loading');
  });
});

describe('where no scan is on offer', () => {
  it('behaves exactly as it did before scanning existed', () => {
    expect(chapterSectionState(input({ allowScan: false })).kind).toBe('hidden');
    expect(
      chapterSectionState(input({ allowScan: false, offered: true, scanned: true })).kind,
    ).toBe('hidden');
  });
});

describe('the offer', () => {
  it('appears for a book that states nothing and has never been scanned', () => {
    expect(chapterSectionState(input({ offered: true })).kind).toBe('offer');
  });

  it('is not shown while a scan is already running', () => {
    /*
     * Both can read true for a moment while the store is being consulted, and a second button
     * press would start a second decode of a book already being decoded.
     */
    expect(chapterSectionState(input({ offered: true, scanning: true })).kind).toBe('scanning');
  });

  it('gives way to what was actually found', () => {
    expect(
      chapterSectionState(input({ scannedMarks: MARKS, offered: true })).kind,
    ).toBe('found');
  });
});

describe('telling the two empty answers apart', () => {
  it('says so when the book was listened to and announces nothing', () => {
    expect(chapterSectionState(input({ scanned: true }))).toEqual({
      kind: 'note',
      note: 'none',
    });
  });

  it('says the model is missing rather than that the book has no chapters', () => {
    // Opposite answers. One is about the book, the other is about this device.
    expect(
      chapterSectionState(
        input({ outcome: { status: 'unavailable', reason: 'no-model' } }),
      ),
    ).toEqual({ kind: 'note', note: 'no-model' });
  });

  it('keeps a refusal to scan distinct from a book with nothing to find', () => {
    expect(
      chapterSectionState(
        input({ outcome: { status: 'unavailable', reason: 'not-worth-it' }, scanned: true }),
      ),
    ).toEqual({ kind: 'note', note: 'not-worth-it' });
  });

  it('reports a file it could not read', () => {
    expect(
      chapterSectionState(
        input({ outcome: { status: 'unavailable', reason: 'decode-failed' } }),
      ),
    ).toEqual({ kind: 'note', note: 'decode-failed' });
  });

  it('stays quiet about a platform that never had a scanner', () => {
    // There was never a button, so a line explaining its absence is noise on every book.
    expect(
      chapterSectionState(
        input({ outcome: { status: 'unavailable', reason: 'no-scanner' } }),
      ).kind,
    ).toBe('hidden');
  });

  it('shows nothing for a book nobody has scanned and nothing was tried on', () => {
    expect(chapterSectionState(input()).kind).toBe('hidden');
  });

  it("prefers this session's failure to a stored finding of none", () => {
    /*
     * A book stored as announcing nothing, opened again after the model was removed. It has been
     * scanned, so 'none' is true and stored — but what just happened is that the listener pressed
     * a button and nothing could run, and that is what they need told.
     */
    expect(
      chapterSectionState(
        input({ scanned: true, outcome: { status: 'unavailable', reason: 'no-model' } }),
      ),
    ).toEqual({ kind: 'note', note: 'no-model' });
  });
});

describe('what a successful scan shows', () => {
  it('shows found chapters, never mixed with stated ones', () => {
    const state = chapterSectionState(input({ scannedMarks: MARKS }));
    expect(state.kind).toBe('found');
  });

  it('does not call a scan that produced nothing a find', () => {
    expect(chapterSectionState(input({ scannedMarks: [], scanned: true })).kind).toBe('note');
  });
});
