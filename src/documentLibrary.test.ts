import { describe, expect, it } from 'vitest';
import {
  documentDisplayName,
  documentSummary,
  newDocumentId,
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
