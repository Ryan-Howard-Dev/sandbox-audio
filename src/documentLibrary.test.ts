import { describe, expect, it } from 'vitest';
import {
  documentDisplayName,
  documentSummary,
  newDocumentId,
  shouldPersistReadingPosition,
  type ReadingPosition,
  type SavedDocument,
} from './documentLibrary';

function doc(partial: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id: 'doc-1',
    name: 'paper.md',
    addedAt: 1_000,
    text: 'body',
    chunkCount: 4,
    estimatedSeconds: 120,
    ...partial,
  };
}

describe('documentSummary', () => {
  /* A shelf renders many cards; carrying megabytes of text into each one is pure waste. */
  it('drops the text so a shelf never loads document bodies', () => {
    const summary = documentSummary(doc({ text: 'x'.repeat(10_000) }));
    expect('text' in summary).toBe(false);
    expect(summary.name).toBe('paper.md');
    expect(summary.chunkCount).toBe(4);
  });
});

describe('documentSummary reading position', () => {
  /* A shelf shows "resume at chapter 4" without loading the book, so the position rides on the card. */
  it('keeps the position on the card while dropping the text', () => {
    const summary = documentSummary(
      doc({ position: { chapterIndex: 3, chunkIndex: 12, updatedAt: 5 } }),
    );
    expect(summary.position?.chapterIndex).toBe(3);
    expect('text' in summary).toBe(false);
  });
});

describe('shouldPersistReadingPosition', () => {
  const at = (chapterIndex: number, chunkIndex: number, updatedAt: number): ReadingPosition => ({
    chapterIndex,
    chunkIndex,
    updatedAt,
  });

  it('writes the first position it is given', () => {
    expect(shouldPersistReadingPosition(null, at(0, 0, 1_000))).toBe(true);
  });

  /*
   * Every write re-puts the whole record, text included. Writing on each chunk change rewrites a
   * book-sized object hundreds of times per chapter.
   */
  it('ignores a chunk-by-chunk crawl', () => {
    expect(shouldPersistReadingPosition(at(0, 4, 1_000), at(0, 5, 2_000))).toBe(false);
  });

  it('always writes a chapter change, which is what a listener would notice losing', () => {
    expect(shouldPersistReadingPosition(at(0, 40, 1_000), at(1, 0, 1_100))).toBe(true);
  });

  it('writes once enough time has passed', () => {
    expect(shouldPersistReadingPosition(at(0, 4, 1_000), at(0, 5, 30_000))).toBe(true);
  });

  it('writes on a jump too large for a tick to explain', () => {
    expect(shouldPersistReadingPosition(at(0, 4, 1_000), at(0, 60, 1_500))).toBe(true);
  });

  it('refuses a nonsense position rather than storing one', () => {
    expect(shouldPersistReadingPosition(at(0, 4, 1_000), at(0, -1, 90_000))).toBe(false);
  });
});

describe('newDocumentId', () => {
  it('derives a readable id from the file name', () => {
    expect(newDocumentId('Loudness Paper.md', 0)).toBe('doc-0-loudness-paper');
  });

  /* Re-importing the same file is a new entry, not a silent overwrite of your position in it. */
  it('gives two imports of the same name distinct ids', () => {
    expect(newDocumentId('paper.md', 1)).not.toBe(newDocumentId('paper.md', 2));
  });

  it('survives a name with no usable characters', () => {
    expect(newDocumentId('___.md', 0)).toBe('doc-0-untitled');
  });

  it('does not produce an unbounded id from a very long name', () => {
    const id = newDocumentId(`${'a'.repeat(300)}.md`, 0);
    expect(id.length).toBeLessThan(60);
  });
});

describe('documentDisplayName', () => {
  it('drops the extension, which is noise on a card', () => {
    expect(documentDisplayName('research-paper.md')).toBe('research-paper');
    expect(documentDisplayName('notes.txt')).toBe('notes');
  });

  it('leaves a name that has no known extension alone', () => {
    expect(documentDisplayName('README')).toBe('README');
    expect(documentDisplayName('v1.2 findings')).toBe('v1.2 findings');
  });

  it('never returns an empty label', () => {
    expect(documentDisplayName('.md')).toBe('.md');
  });
});
