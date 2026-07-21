import { describe, expect, it } from 'vitest';
import {
  gutendexBookToCatalog,
  gutenbergChaptersFromIndex,
  parseGutenbergMp3Filenames,
} from '../tier34-server/lib/audiobookGutenbergCore';
import {
  loyalbooksChaptersFromFeed,
  searchLoyalbooksFeed,
} from '../tier34-server/lib/audiobookLoyalbooksCore';
import { searchLoyalbooksFeedIndex } from '../tier34-server/lib/audiobookLoyalbooksFeeds';

const AMERICAN_NOTES_README = `
American Notes by Charles Dickens
It is available as a series of MP3 files, one file per chapter.

  9693-000.mp3
  9693-001.mp3
  9693-002.mp3
`;

describe('audiobookGutenbergCore', () => {
  it('maps Gutendex Sound editions to catalog books', () => {
    const book = gutendexBookToCatalog({
      id: 9693,
      title: 'American Notes',
      authors: [{ name: 'Dickens, Charles' }],
      media_type: 'Sound',
      formats: {
        'audio/mpeg': 'https://www.gutenberg.org/files/9693/mp3/9693-000.mp3',
        'image/jpeg': 'https://www.gutenberg.org/cache/epub/9693/pg9693.cover.medium.jpg',
      },
    });
    expect(book?.source).toBe('gutenberg');
    expect(book?.id).toBe('gutenberg:9693');
    expect(book?.author).toContain('Dickens');
  });

  it('rejects text-only Gutendex books', () => {
    const book = gutendexBookToCatalog({
      id: 1342,
      title: 'Pride and Prejudice',
      media_type: 'Text',
      formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/1342.txt.utf-8' },
    });
    expect(book).toBeNull();
  });

  it('parses MP3 filenames from readme index', () => {
    const files = parseGutenbergMp3Filenames(AMERICAN_NOTES_README);
    expect(files).toEqual(['9693-000.mp3', '9693-001.mp3', '9693-002.mp3']);
  });

  it('builds chapter list from index and sample audio URL', () => {
    const chapters = gutenbergChaptersFromIndex(
      '9693',
      { 'audio/mpeg': 'https://www.gutenberg.org/files/9693/mp3/9693-000.mp3' },
      AMERICAN_NOTES_README,
    );
    expect(chapters).toHaveLength(3);
    expect(chapters[0].audioUrl).toContain('9693-000.mp3');
    expect(chapters[2].audioUrl).toContain('9693-002.mp3');
    expect(chapters[0].source).toBe('gutenberg');
  });
});

describe('audiobookLoyalbooksCore', () => {
  const feed = {
    feedId: 'loyal-pride',
    feedUrl: 'https://www.loyalbooks.com/book/pride-and-prejudice/feed',
    title: 'Pride and Prejudice',
    description: 'Jane Austen classic',
    episodes: [
      {
        id: 'ch-1',
        guid: 'ch-1',
        title: 'Chapter 1',
        audioUrl: 'https://cdn.example.com/ch1.mp3',
        durationSeconds: 750,
      },
      {
        id: 'ch-2',
        guid: 'ch-2',
        title: 'Chapter 2',
        audioUrl: 'https://cdn.example.com/ch2.mp3',
        durationSeconds: 600,
      },
    ],
  };

  const meta = {
    slug: 'pride-and-prejudice',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
  };

  it('searches curated Loyal Books index by title', () => {
    const hits = searchLoyalbooksFeedIndex('frankenstein');
    expect(hits.some((h) => h.slug.includes('frankenstein'))).toBe(true);
  });

  it('maps Loyal Books RSS to loyalbooks source', () => {
    const hits = searchLoyalbooksFeed(feed, 'pride', meta);
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('loyalbooks');
    expect(hits[0].id).toBe('loyalbooks:pride-and-prejudice');
    expect(hits[0].author).toBe('Jane Austen');
  });

  it('builds loyalbooks chapters from RSS feed', () => {
    const chapters = loyalbooksChaptersFromFeed(meta, feed);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].source).toBe('loyalbooks');
    expect(chapters[0].bookId).toBe('loyalbooks:pride-and-prejudice');
  });
});
