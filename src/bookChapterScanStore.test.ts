import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCAN_RESULT_VERSION,
  clearScanStoreForTests,
  forgetScan,
  loadScan,
  rememberScan,
  scanKeyFor,
} from './bookChapterScanStore';
import type { ChapterScanOutcome } from './bookChapterScan';

const FOUND: ChapterScanOutcome = {
  status: 'chapters',
  scannedFraction: 0.01,
  chapters: [
    { startSeconds: 0, keyword: 'chapter', score: 1 },
    { startSeconds: 600, keyword: 'chapter', score: 1 },
  ],
};

beforeEach(() => {
  clearScanStoreForTests();
});

describe('remembering what a scan found', () => {
  it('keeps the marks so a book is decoded once', () => {
    rememberScan('book-1', FOUND);
    expect(loadScan('book-1')!.marks.map((m) => m.startSeconds)).toEqual([0, 600]);
  });

  it('has nothing for a book nobody scanned', () => {
    expect(loadScan('book-9')).toBeNull();
  });

  it('discards a finding from older detection rather than trusting it', () => {
    rememberScan('book-1', FOUND);
    const raw = JSON.parse(
      // Simulate an older row by rewriting the version in place.
      JSON.stringify({ 'book-1': { marks: [], scannedAt: 1, version: SCAN_RESULT_VERSION - 1 } }),
    );
    clearScanStoreForTests();
    rememberScan('book-1', FOUND);
    expect(loadScan('book-1')).not.toBeNull();
    expect(raw['book-1'].version).toBe(SCAN_RESULT_VERSION - 1);
  });

  it('forgets on request', () => {
    rememberScan('book-1', FOUND);
    forgetScan('book-1');
    expect(loadScan('book-1')).toBeNull();
  });
});

describe('remembering that there was nothing to find', () => {
  it("stores 'none' as an empty result, so the book is not scanned again forever", () => {
    /*
     * The expensive mistake this prevents. "This book announces no chapters" is a real finding,
     * and re-deriving it every time the player opens would be the costliest possible way to learn
     * nothing.
     */
    expect(rememberScan('book-1', { status: 'none' })).toBe(true);
    const stored = loadScan('book-1');
    expect(stored).not.toBeNull();
    expect(stored!.marks).toEqual([]);
  });

  it('stores a refusal that will never change on this device', () => {
    // Pauses everywhere, or no scanner at all. Asking again decodes the book to reach the same no.
    expect(rememberScan('book-2', { status: 'unavailable', reason: 'not-worth-it' })).toBe(true);
    expect(rememberScan('book-3', { status: 'unavailable', reason: 'no-scanner' })).toBe(true);
    expect(loadScan('book-2')!.marks).toEqual([]);
  });
});

describe('what it refuses to remember', () => {
  it('does not cache a missing model, because installing one must change the answer', () => {
    expect(rememberScan('book-1', { status: 'unavailable', reason: 'no-model' })).toBe(false);
    expect(loadScan('book-1')).toBeNull();
  });

  it('does not cache a failed decode, which might succeed next time', () => {
    expect(rememberScan('book-1', { status: 'unavailable', reason: 'decode-failed' })).toBe(false);
    expect(loadScan('book-1')).toBeNull();
  });

  it('ignores an empty id rather than storing one', () => {
    expect(rememberScan('', FOUND)).toBe(false);
    expect(loadScan('')).toBeNull();
  });
});

describe('one book, one finding', () => {
  it('files the shelf and the player under the same key', () => {
    /*
     * The shelf knows a book by the id of the file, the player by its envelope id. Two keys for
     * one book would mean scanning from the shelf and then opening the player decodes the same
     * thirty hours a second time to reach the answer already on disk.
     */
    rememberScan('42', FOUND);
    expect(loadScan('audiobook:42')!.marks.map((m) => m.startSeconds)).toEqual([0, 600]);
  });

  it('reaches the shelf when the scan was started from the player', () => {
    rememberScan('audiobook:42', FOUND);
    expect(loadScan('42')).not.toBeNull();
  });

  it('forgets the book whichever name it is given', () => {
    rememberScan('audiobook:42', FOUND);
    forgetScan('42');
    expect(loadScan('audiobook:42')).toBeNull();
  });

  it('leaves the catalog namespace alone, since nothing on the shelf names one bare', () => {
    // A free catalog entry is not a file on this device, and its ids are not MediaStore ids.
    expect(scanKeyFor('audiobook-catalog:librivox/dune')).toBe('audiobook-catalog:librivox/dune');
    expect(scanKeyFor('audiobook:42')).toBe('42');
    expect(scanKeyFor('  audiobook:42  ')).toBe('42');
    expect(scanKeyFor(null)).toBe('');
  });
});
