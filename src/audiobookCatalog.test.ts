import { describe, expect, it } from 'vitest';
import {
  AUDIOBOOK_CATALOG_ENVELOPE_PREFIX,
  AUDIOBOOK_CATALOG_SOURCES,
  AUDIOBOOK_TIER34_CHAPTER_SOURCES,
  catalogChapterEnvelope,
  isAudiobookCatalogEnvelopeId,
  type AudiobookCatalogBook,
  type AudiobookCatalogChapter,
} from './audiobookCatalog';

const book: AudiobookCatalogBook = {
  id: 'librivox:253',
  sourceId: '253',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  source: 'librivox',
};

const chapter: AudiobookCatalogChapter = {
  id: '124135',
  bookId: 'librivox:253',
  title: 'Chapters 1-3',
  audioUrl: 'https://archive.org/download/pride_and_prejudice_librivox/prideandprejudice_01-03_austen_64kb.mp3',
  durationSeconds: 1132,
  chapterNumber: 1,
  source: 'librivox',
};

describe('audiobookCatalog', () => {
  it('detects catalog envelope ids', () => {
    expect(isAudiobookCatalogEnvelopeId('audiobook-catalog:librivox:253:124135')).toBe(true);
    expect(isAudiobookCatalogEnvelopeId('audiobook:123')).toBe(false);
  });

  it('builds stable catalog chapter envelopes', () => {
    const env = catalogChapterEnvelope(chapter, book);
    expect(env.envelopeId.startsWith(AUDIOBOOK_CATALOG_ENVELOPE_PREFIX)).toBe(true);
    expect(env.title).toBe('Chapters 1-3');
    expect(env.artist).toBe('Jane Austen');
    expect(env.album).toBe('Pride and Prejudice');
    expect(env.url).toContain('archive.org');
    expect(env.durationSeconds).toBe(1132);
  });

  it('lists all Discover sources including scrape-index and meta-search', () => {
    const ids = AUDIOBOOK_CATALOG_SOURCES.map((s) => s.id);
    expect(ids).toEqual([
      'librivox',
      'archive',
      'gutenberg',
      'loyalbooks',
      'rss',
      'ravebooksearch',
      'learnoutloud',
      'lit2go',
      'goldenaudiobooks',
      'audiobooks4soul',
    ]);
  });

  it('no longer requires Tier34 for scrape-index chapters (on-device scrape client)', () => {
    expect(AUDIOBOOK_TIER34_CHAPTER_SOURCES.size).toBe(0);
    expect(AUDIOBOOK_TIER34_CHAPTER_SOURCES.has('lit2go')).toBe(false);
    expect(AUDIOBOOK_TIER34_CHAPTER_SOURCES.has('learnoutloud')).toBe(false);
  });
});

