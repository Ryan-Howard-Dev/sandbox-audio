import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cleanRaveBookTitle,
  extractArchiveIdentifierFromUrl,
  isAudiobookRelevantRaveResult,
  parseRaveBookSearchResults,
  raveBookSearchId,
} from '../tier34-server/lib/audiobookRaveBookSearchCore';
import { dedupeAudiobookBooks } from '../tier34-server/lib/audiobookRssCore';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../tier34-server/fixtures');

function loadFixture(name: string): { results: unknown[] } {
  const raw = readFileSync(join(fixtureDir, name), 'utf8');
  return JSON.parse(raw) as { results: unknown[] };
}

describe('audiobookRaveBookSearchCore', () => {
  it('cleans ISBN blobs from titles', () => {
    expect(cleanRaveBookTitle('Dune; 9780441013593 b l 123456')).toBe('Dune');
  });

  it('keeps Internet Archive librivox hits for audiobook mode', () => {
    expect(
      isAudiobookRelevantRaveResult({
        title: "Alice's Adventures in Wonderland",
        source: 'Internet Archive',
        downloadUrl: 'https://archive.org/details/alice_in_wonderland_librivox',
        format: 'pdf',
      }),
    ).toBe(true);
  });

  it('skips Anna Archive ebook-only rows', () => {
    expect(
      isAudiobookRelevantRaveResult({
        title: 'Alice-Miranda Shines Bright',
        source: "Anna's Archive",
        downloadUrl: 'https://annas-archive.gl/slow_download/abc/0/0',
        format: '',
      }),
    ).toBe(false);
  });

  it('extracts archive.org identifiers from detail URLs', () => {
    expect(
      extractArchiveIdentifierFromUrl('https://archive.org/details/alice_in_wonderland_librivox'),
    ).toBe('alice_in_wonderland_librivox');
  });

  it('parses alice fixture into attributed catalog books', () => {
    const fixture = loadFixture('ravebooksearch_alice.json');
    const books = parseRaveBookSearchResults(fixture.results as never[], 12);
    expect(books.length).toBeGreaterThan(0);
    expect(books.every((b) => b.source === 'ravebooksearch')).toBe(true);
    expect(books[0].description).toMatch(/^via /);
    expect(books[0].detailUrl).toContain('archive.org');
    expect(raveBookSearchId(books[0].detailUrl!)).toBe(books[0].id);
  });

  it('dedupes meta-search when librivox already has the same title', () => {
    const librivox = {
      id: 'librivox:1',
      sourceId: '1',
      title: "Alice's Adventures in Wonderland",
      author: 'Lewis Carroll',
      source: 'librivox' as const,
    };
    const meta = {
      id: 'ravebooksearch:abc',
      sourceId: 'https://archive.org/details/alice_in_wonderland_librivox',
      title: "Alice's Adventures in Wonderland",
      author: 'Lewis Carroll',
      source: 'ravebooksearch' as const,
      detailUrl: 'https://archive.org/details/alice_in_wonderland_librivox',
    };
    const merged = dedupeAudiobookBooks([meta, librivox]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('librivox');
  });
});
