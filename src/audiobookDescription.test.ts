import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./airGapMode', () => ({ isAirGapEnabled: vi.fn(() => false) }));
vi.mock('./fetchWithTimeout', () => ({ fetchWithTimeout: vi.fn() }));

import { isAirGapEnabled } from './airGapMode';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  audiobookDescriptionKey,
  buildGoogleBooksQueryUrl,
  buildOpenLibrarySearchUrl,
  normalizeBookQuery,
  cacheAudiobookDescription,
  fetchAudiobookDescription,
  getCachedAudiobookDescription,
  parseGoogleBooksDescription,
  parseOpenLibraryDescription,
  parseOpenLibraryWorkKey,
} from './audiobookDescription';

describe('audiobookDescriptionKey', () => {
  it('is case and whitespace insensitive so a rescan reuses the cache', () => {
    expect(audiobookDescriptionKey(' Animal Farm ', 'George Orwell')).toBe(
      audiobookDescriptionKey('animal farm', ' GEORGE ORWELL'),
    );
  });
});

describe('parseGoogleBooksDescription', () => {
  it('takes the first volume that actually has a description', () => {
    expect(
      parseGoogleBooksDescription({
        items: [{ volumeInfo: {} }, { volumeInfo: { description: '  A satire.  ' } }],
      }),
    ).toBe('A satire.');
  });

  it('returns null for empty, malformed, or missing payloads', () => {
    expect(parseGoogleBooksDescription({ items: [] })).toBeNull();
    expect(parseGoogleBooksDescription({ items: [{ volumeInfo: { description: '   ' } }] })).toBeNull();
    expect(parseGoogleBooksDescription({ totalItems: 0 })).toBeNull();
    expect(parseGoogleBooksDescription(null)).toBeNull();
  });
});

describe('Open Library parsing', () => {
  it('takes the first work key from a search response', () => {
    expect(
      parseOpenLibraryWorkKey({ docs: [{ key: '/authors/OL1A' }, { key: '/works/OL262758W' }] }),
    ).toBe('/works/OL262758W');
    expect(parseOpenLibraryWorkKey({ docs: [] })).toBeNull();
    expect(parseOpenLibraryWorkKey(null)).toBeNull();
  });

  it('reads a description given as a plain string or as { value }', () => {
    expect(parseOpenLibraryDescription({ description: '  A satire.  ' })).toBe('A satire.');
    expect(
      parseOpenLibraryDescription({ description: { type: '/type/text', value: 'A satire.' } }),
    ).toBe('A satire.');
    expect(parseOpenLibraryDescription({})).toBeNull();
    expect(parseOpenLibraryDescription({ description: { value: '  ' } })).toBeNull();
  });

  it('searches free-text, since strict title/author returns nothing for scanned files', () => {
    const url = buildOpenLibrarySearchUrl('Animal Farm', 'George Orwell');
    expect(url).toContain('q=Animal+Farm+George+Orwell');
    expect(url).not.toContain('title=');
  });
});

describe('buildGoogleBooksQueryUrl', () => {
  it('uses the same normalized query as Open Library', () => {
    expect(buildGoogleBooksQueryUrl('Animal Farm', 'George Orwell')).toContain(
      encodeURIComponent('Animal Farm George Orwell'),
    );
  });
});

describe('normalizeBookQuery', () => {
  // These are real titles from a device scan — the file names them, not the tags.
  it('moves a trailing "by Author" out of the title and ignores the uploader', () => {
    expect(
      normalizeBookQuery(
        'Underworld The Mysterious Origins Of Civilization by Graham Hancock',
        'motivator8',
      ),
    ).toBe('Underworld The Mysterious Origins Of Civilization Graham Hancock');
  });

  it('drops placeholder authors instead of searching for them', () => {
    expect(
      normalizeBookQuery('The Silk Roads A New History of the World by Peter Frankopan', 'Unknown author'),
    ).toBe('The Silk Roads A New History of the World Peter Frankopan');
    expect(normalizeBookQuery('Animal Farm', 'Unknown')).toBe('Animal Farm');
  });

  it('splits run-together file names into searchable words', () => {
    expect(normalizeBookQuery('TheSacredMushroom', 'Unknown author')).toBe('The Sacred Mushroom');
  });

  it('strips extensions, separators and rip noise', () => {
    expect(normalizeBookQuery('Animal_Farm.unabridged.mp3', 'George Orwell')).toBe(
      'Animal Farm George Orwell',
    );
  });

  it('keeps a clean title and author untouched', () => {
    expect(normalizeBookQuery('An Introduction to Zen Buddhism', 'Daisetsu Teitaro Suzuki')).toBe(
      'An Introduction to Zen Buddhism Daisetsu Teitaro Suzuki',
    );
  });
});

describe('fetchAudiobookDescription', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchWithTimeout).mockReset();
    vi.mocked(isAirGapEnabled).mockReturnValue(false);
  });

  it('returns a cached hit without hitting the network', async () => {
    cacheAudiobookDescription('Animal Farm', 'George Orwell', 'A satire.');
    const fetchSpy = vi.mocked(fetchWithTimeout);
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBe(
      'A satire.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caches a miss so a bookless title is not re-fetched every open', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as unknown as Response);

    await expect(fetchAudiobookDescription('Chris Caulk Streams', 'Chris Caulk')).resolves.toBeNull();
    expect(getCachedAudiobookDescription('Chris Caulk Streams', 'Chris Caulk')).toBe('');

    vi.mocked(fetchWithTimeout).mockClear();
    await fetchAudiobookDescription('Chris Caulk Streams', 'Chris Caulk');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('makes no network call in air-gap mode', async () => {
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    const fetchSpy = vi.mocked(fetchWithTimeout);
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves null rather than throwing when the lookup fails', async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('offline'));
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBeNull();
  });

  it('ignores an untitled book', async () => {
    await expect(fetchAudiobookDescription('   ', 'Anon')).resolves.toBeNull();
  });

  it('prefers Open Library and never reaches Google Books when it answers', async () => {
    const calls: string[] = [];
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      calls.push(String(url));
      const body = String(url).includes('search.json')
        ? { docs: [{ key: '/works/OL262758W' }] }
        : { description: { value: 'A satire.' } };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBe(
      'A satire.',
    );
    expect(calls.every((u) => u.includes('openlibrary.org'))).toBe(true);
    expect(calls.some((u) => u.includes('googleapis.com'))).toBe(false);
  });

  it('falls back to Google Books when Open Library has no description', async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const u = String(url);
      const body = u.includes('search.json')
        ? { docs: [{ key: '/works/OL1W' }] }
        : u.includes('googleapis.com')
          ? { items: [{ volumeInfo: { description: 'From Google.' } }] }
          : {}; // work record exists but carries no description
      return { ok: true, json: async () => body } as unknown as Response;
    });

    await expect(fetchAudiobookDescription('Underworld', 'Graham Hancock')).resolves.toBe(
      'From Google.',
    );
  });

  it('does not cache a miss when the lookup itself failed', async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('offline'));
    await fetchAudiobookDescription('Animal Farm', 'George Orwell');
    // A network blip must not permanently mark the book as having no description.
    expect(getCachedAudiobookDescription('Animal Farm', 'George Orwell')).toBeNull();
  });
});
