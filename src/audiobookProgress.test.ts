import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIOBOOK_PROGRESS_MIN_SECONDS,
  audiobookBookKeyFromCatalogBook,
  audiobookBookKeyFromEnvelopeId,
  audiobookProgressPercent,
  canonicalAudiobookBookKey,
  clearAudiobookProgress,
  getAudiobookProgress,
  isAudiobookFinished,
  listAudiobooksInProgress,
  mergeAudiobookProgress,
  saveAudiobookProgress,
  shouldPersistAudiobookProgress,
  type AudiobookProgress,
} from './audiobookProgress';

function entry(partial: Partial<AudiobookProgress> & { bookKey: string }): AudiobookProgress {
  return {
    chapterIndex: 0,
    offsetSeconds: 100,
    durationSeconds: 600,
    chapterCount: 10,
    updatedAt: 1_000,
    ...partial,
  };
}

describe('audiobookBookKeyFromEnvelopeId', () => {
  it('drops the chapter segment from a catalog id', () => {
    expect(audiobookBookKeyFromEnvelopeId('audiobook-catalog:librivox:19037:601981')).toBe(
      'audiobook-catalog:librivox:19037',
    );
  });

  /*
   * The bug this file exists to prevent, found by playing a book on a device. Gutenberg chapter
   * ids are themselves `gutenberg:<book>:<index>`, so a full envelope id has six segments. Keying
   * off the *last* segment produced `…:1234:gutenberg:1234` while the book card produced
   * `…:1234` — progress written under one key, read under another. No badge, no shelf entry, no
   * resume, and nothing failing loudly.
   */
  it('handles a chapter id that itself contains colons', () => {
    expect(audiobookBookKeyFromEnvelopeId('audiobook-catalog:gutenberg:1234:gutenberg:1234:0')).toBe(
      'audiobook-catalog:gutenberg:1234',
    );
  });

  it('treats every chapter of one book as the same book', () => {
    const a = audiobookBookKeyFromEnvelopeId('audiobook-catalog:librivox:19037:601981');
    const b = audiobookBookKeyFromEnvelopeId('audiobook-catalog:librivox:19037:601999');
    expect(a).toBe(b);
  });

  it('keys a device-library book on itself — the file is the book', () => {
    expect(audiobookBookKeyFromEnvelopeId('audiobook:local-42')).toBe('audiobook:local-42');
  });

  it('returns null for anything that is not an audiobook', () => {
    expect(audiobookBookKeyFromEnvelopeId('local-1')).toBeNull();
    expect(audiobookBookKeyFromEnvelopeId('podcast:feed:ep-1')).toBeNull();
    expect(audiobookBookKeyFromEnvelopeId('')).toBeNull();
    expect(audiobookBookKeyFromEnvelopeId(null)).toBeNull();
  });

  it('returns null for a malformed catalog id rather than a bogus key', () => {
    expect(audiobookBookKeyFromEnvelopeId('audiobook-catalog:librivox')).toBeNull();
  });
});

describe('audiobookBookKeyFromCatalogBook', () => {
  /*
   * The invariant that matters: a badge derives the key from the book card, playback derives it
   * from the envelope. If those ever disagree, a book records progress under one key and reads it
   * back under another, and resume silently never fires — with nothing failing loudly.
   */
  it('agrees with the key derived from a playing envelope', () => {
    const fromCard = audiobookBookKeyFromCatalogBook('librivox', 'librivox:19037');
    const fromEnvelope = audiobookBookKeyFromEnvelopeId('audiobook-catalog:librivox:19037:601981');
    expect(fromCard).toBe(fromEnvelope);
  });

  /* The real-world case that was broken: Gutenberg, whose chapter ids carry colons. */
  it('agrees for Gutenberg, whose chapter id repeats the book id', () => {
    const fromCard = audiobookBookKeyFromCatalogBook('gutenberg', 'gutenberg:1234');
    const fromEnvelope = audiobookBookKeyFromEnvelopeId(
      'audiobook-catalog:gutenberg:1234:gutenberg:1234:0',
    );
    expect(fromCard).toBe('audiobook-catalog:gutenberg:1234');
    expect(fromCard).toBe(fromEnvelope);
  });

  it('agrees for a hashed scrape id', () => {
    const fromCard = audiobookBookKeyFromCatalogBook('goldenaudiobooks', 'goldenaudiobooks:a1b2');
    const fromEnvelope = audiobookBookKeyFromEnvelopeId('audiobook-catalog:goldenaudiobooks:a1b2:7');
    expect(fromCard).toBe(fromEnvelope);
  });

  it('returns null rather than a malformed key', () => {
    expect(audiobookBookKeyFromCatalogBook('', 'librivox:1')).toBeNull();
    expect(audiobookBookKeyFromCatalogBook('librivox', '')).toBeNull();
    // No segment after the source is not a usable book id.
    expect(audiobookBookKeyFromCatalogBook('librivox', 'librivox')).toBeNull();
  });
});

describe('audiobookProgressPercent', () => {
  it('counts completed chapters plus position in the current one', () => {
    expect(
      audiobookProgressPercent(
        entry({ bookKey: 'b', chapterIndex: 5, offsetSeconds: 300, durationSeconds: 600 }),
      ),
    ).toBe(55);
  });

  it('falls back to position in the chapter when the count is unknown', () => {
    expect(
      audiobookProgressPercent(
        entry({ bookKey: 'b', chapterCount: 0, offsetSeconds: 150, durationSeconds: 600 }),
      ),
    ).toBe(25);
  });

  it('never exceeds 100', () => {
    expect(
      audiobookProgressPercent(
        entry({ bookKey: 'b', chapterIndex: 20, chapterCount: 10, offsetSeconds: 600, durationSeconds: 600 }),
      ),
    ).toBe(100);
  });
});

describe('isAudiobookFinished', () => {
  it('is false while earlier chapters remain', () => {
    expect(
      isAudiobookFinished(
        entry({ bookKey: 'b', chapterIndex: 3, chapterCount: 10, offsetSeconds: 600, durationSeconds: 600 }),
      ),
    ).toBe(false);
  });

  it('is true at the end of the last chapter', () => {
    expect(
      isAudiobookFinished(
        entry({ bookKey: 'b', chapterIndex: 9, chapterCount: 10, offsetSeconds: 599, durationSeconds: 600 }),
      ),
    ).toBe(true);
  });

  it('is false when the duration is unknown, rather than guessing', () => {
    expect(
      isAudiobookFinished(entry({ bookKey: 'b', chapterIndex: 9, chapterCount: 10, durationSeconds: 0 })),
    ).toBe(false);
  });
});

describe('shouldPersistAudiobookProgress', () => {
  /*
   * Playback emits position updates several times a second. Writing each one would hammer storage
   * for the entire length of a book.
   */
  it('ignores a tick that moved almost nothing', () => {
    const prev = entry({ bookKey: 'b', offsetSeconds: 100, updatedAt: 1_000 });
    const next = entry({ bookKey: 'b', offsetSeconds: 101, updatedAt: 2_000 });
    expect(shouldPersistAudiobookProgress(prev, next)).toBe(false);
  });

  it('writes once the interval has passed', () => {
    const prev = entry({ bookKey: 'b', offsetSeconds: 100, updatedAt: 1_000 });
    const next = entry({ bookKey: 'b', offsetSeconds: 105, updatedAt: 12_000 });
    expect(shouldPersistAudiobookProgress(prev, next)).toBe(true);
  });

  it('writes immediately on a seek, which a tick cannot explain', () => {
    const prev = entry({ bookKey: 'b', offsetSeconds: 100, updatedAt: 1_000 });
    const next = entry({ bookKey: 'b', offsetSeconds: 400, updatedAt: 1_500 });
    expect(shouldPersistAudiobookProgress(prev, next)).toBe(true);
  });

  it('writes immediately on a chapter change', () => {
    const prev = entry({ bookKey: 'b', chapterIndex: 2, offsetSeconds: 590, updatedAt: 1_000 });
    const next = entry({ bookKey: 'b', chapterIndex: 3, offsetSeconds: 1, updatedAt: 1_200 });
    expect(shouldPersistAudiobookProgress(prev, next)).toBe(true);
  });

  /* Opening a book and immediately closing it should not put it on a continue-listening shelf. */
  it('does not record a book that barely started', () => {
    expect(
      shouldPersistAudiobookProgress(undefined, entry({ bookKey: 'b', offsetSeconds: 3 })),
    ).toBe(false);
    expect(
      shouldPersistAudiobookProgress(
        undefined,
        entry({ bookKey: 'b', offsetSeconds: AUDIOBOOK_PROGRESS_MIN_SECONDS }),
      ),
    ).toBe(true);
  });
});

describe('mergeAudiobookProgress', () => {
  it('takes the newer entry per book', () => {
    const local = { a: entry({ bookKey: 'a', offsetSeconds: 10, updatedAt: 5 }) };
    const remote = { a: entry({ bookKey: 'a', offsetSeconds: 900, updatedAt: 9 }) };
    expect(mergeAudiobookProgress(local, remote).a!.offsetSeconds).toBe(900);
  });

  /* A device with a skewed clock must not be able to rewind a position it never advanced. */
  it('keeps the local entry on a tie', () => {
    const local = { a: entry({ bookKey: 'a', offsetSeconds: 900, updatedAt: 5 }) };
    const remote = { a: entry({ bookKey: 'a', offsetSeconds: 10, updatedAt: 5 }) };
    expect(mergeAudiobookProgress(local, remote).a!.offsetSeconds).toBe(900);
  });

  it('unions books that only one side has', () => {
    const local = { a: entry({ bookKey: 'a' }) };
    const remote = { b: entry({ bookKey: 'b' }) };
    expect(Object.keys(mergeAudiobookProgress(local, remote)).sort()).toEqual(['a', 'b']);
  });
});

describe('storage round trip', () => {
  beforeEach(() => localStorage.clear());

  it('saves and reads back a position', () => {
    saveAudiobookProgress(entry({ bookKey: 'audiobook-catalog:librivox:19037', offsetSeconds: 42 }));
    expect(getAudiobookProgress('audiobook-catalog:librivox:19037')?.offsetSeconds).toBe(42);
  });

  /*
   * Position updates come from a playback envelope, which knows nothing about the catalog. A
   * blind write would erase the locator and display snapshot on the first tick, and the shelf
   * would lose the book it exists to show.
   */
  it('keeps the locator and display snapshot when a position update omits them', () => {
    saveAudiobookProgress(
      entry({
        bookKey: 'k',
        title: 'The Red House Mystery',
        author: 'A. A. Milne',
        artworkUrl: 'https://x/cover.jpg',
        locator: { source: 'gutenberg', sourceId: '1234' },
      }),
    );
    saveAudiobookProgress(entry({ bookKey: 'k', offsetSeconds: 900, updatedAt: 2_000 }));
    const saved = getAudiobookProgress('k');
    expect(saved?.offsetSeconds).toBe(900);
    expect(saved?.title).toBe('The Red House Mystery');
    expect(saved?.author).toBe('A. A. Milne');
    expect(saved?.locator?.sourceId).toBe('1234');
  });

  it('returns null for an unknown or blank key', () => {
    expect(getAudiobookProgress('nope')).toBeNull();
    expect(getAudiobookProgress('')).toBeNull();
  });

  it('clears one book without touching the others', () => {
    saveAudiobookProgress(entry({ bookKey: 'a' }));
    saveAudiobookProgress(entry({ bookKey: 'b' }));
    clearAudiobookProgress('a');
    expect(getAudiobookProgress('a')).toBeNull();
    expect(getAudiobookProgress('b')).not.toBeNull();
  });

  it('lists in-progress books newest first, excluding finished and barely-started', () => {
    saveAudiobookProgress(entry({ bookKey: 'old', offsetSeconds: 300, updatedAt: 10 }));
    saveAudiobookProgress(entry({ bookKey: 'new', offsetSeconds: 300, updatedAt: 99 }));
    saveAudiobookProgress(entry({ bookKey: 'barely', offsetSeconds: 2, updatedAt: 50 }));
    saveAudiobookProgress(
      entry({
        bookKey: 'done',
        chapterIndex: 9,
        chapterCount: 10,
        offsetSeconds: 600,
        durationSeconds: 600,
        updatedAt: 60,
      }),
    );
    expect(listAudiobooksInProgress().map((e) => e.bookKey)).toEqual(['new', 'old']);
  });

  it('survives corrupt stored JSON rather than throwing', () => {
    localStorage.setItem('sandbox_audiobook_progress_v1', '{not json');
    expect(getAudiobookProgress('a')).toBeNull();
    expect(listAudiobooksInProgress()).toEqual([]);
  });
});

/*
 * The continue-listening duplicate, from the exact pair found on the device: one book stored under
 * both the corrected key and the key the old derivation produced, showing twice at 21% and 10%.
 */
describe('legacy book key migration', () => {
  const legacy: AudiobookProgress = {
    bookKey: 'audiobook-catalog:gutenberg:26470:26470',
    chapterIndex: 1,
    offsetSeconds: 120,
    durationSeconds: 900,
    chapterCount: 20,
    updatedAt: 1_000,
    title: 'The Red House Mystery',
    author: 'Milne, A. A. (Alan Alexander)',
    locator: { source: 'gutenberg', sourceId: '26470' },
  };
  const current: AudiobookProgress = {
    bookKey: 'audiobook-catalog:gutenberg:26470',
    chapterIndex: 4,
    offsetSeconds: 300,
    durationSeconds: 900,
    chapterCount: 20,
    updatedAt: 2_000,
    title: 'The Red House Mystery',
  };

  function storeBoth(): void {
    localStorage.setItem(
      'sandbox_audiobook_progress_v1',
      JSON.stringify({ [legacy.bookKey]: legacy, [current.bookKey]: current }),
    );
  }

  it('canonicalises a key that kept a chapter segment', () => {
    expect(canonicalAudiobookBookKey('audiobook-catalog:gutenberg:26470:26470')).toBe(
      'audiobook-catalog:gutenberg:26470',
    );
  });

  it('leaves an already-canonical key and a device id alone', () => {
    expect(canonicalAudiobookBookKey('audiobook-catalog:gutenberg:26470')).toBe(
      'audiobook-catalog:gutenberg:26470',
    );
    expect(canonicalAudiobookBookKey('audiobook:local-42')).toBe('audiobook:local-42');
  });

  it('shows the book once, at the newer position', () => {
    storeBoth();

    const shelf = listAudiobooksInProgress();

    expect(shelf).toHaveLength(1);
    expect(shelf[0]!.bookKey).toBe('audiobook-catalog:gutenberg:26470');
    expect(shelf[0]!.offsetSeconds).toBe(300);
  });

  /*
   * The locator is written once when playback starts, so it usually lives on the older entry --
   * taking the newer record wholesale would strip the shelf of what it needs to re-fetch.
   */
  it('keeps the locator from the older entry', () => {
    storeBoth();

    expect(getAudiobookProgress('audiobook-catalog:gutenberg:26470')?.locator).toEqual({
      source: 'gutenberg',
      sourceId: '26470',
    });
  });

  it('rewrites storage so the duplicate does not come back', () => {
    storeBoth();

    listAudiobooksInProgress();

    const stored = JSON.parse(localStorage.getItem('sandbox_audiobook_progress_v1')!);
    expect(Object.keys(stored)).toEqual(['audiobook-catalog:gutenberg:26470']);
  });

  it('finds an entry when looked up by its legacy key', () => {
    saveAudiobookProgress(current);

    expect(getAudiobookProgress('audiobook-catalog:gutenberg:26470:26470')?.offsetSeconds).toBe(300);
  });
});
