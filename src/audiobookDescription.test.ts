import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./airGapMode', () => ({ isAirGapEnabled: vi.fn(() => false) }));

import { isAirGapEnabled } from './airGapMode';
import {
  audiobookDescriptionKey,
  buildGoogleBooksQueryUrl,
  cacheAudiobookDescription,
  fetchAudiobookDescription,
  getCachedAudiobookDescription,
  parseGoogleBooksDescription,
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

describe('buildGoogleBooksQueryUrl', () => {
  it('scopes the query to title and author', () => {
    const url = buildGoogleBooksQueryUrl('Animal Farm', 'George Orwell');
    expect(url).toContain(encodeURIComponent('intitle:Animal Farm'));
    expect(url).toContain(encodeURIComponent('inauthor:George Orwell'));
  });

  it('omits the author term when unknown', () => {
    expect(buildGoogleBooksQueryUrl('Animal Farm', '  ')).not.toContain('inauthor');
  });
});

describe('fetchAudiobookDescription', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(isAirGapEnabled).mockReturnValue(false);
    vi.restoreAllMocks();
  });

  it('returns a cached hit without hitting the network', async () => {
    cacheAudiobookDescription('Animal Farm', 'George Orwell', 'A satire.');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBe(
      'A satire.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caches a miss so a bookless title is not re-fetched every open', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as unknown as Response);

    await expect(fetchAudiobookDescription('Chris Caulk Streams', 'Chris Caulk')).resolves.toBeNull();
    expect(getCachedAudiobookDescription('Chris Caulk Streams', 'Chris Caulk')).toBe('');

    const second = vi.spyOn(globalThis, 'fetch');
    await fetchAudiobookDescription('Chris Caulk Streams', 'Chris Caulk');
    expect(second).not.toHaveBeenCalled();
  });

  it('makes no network call in air-gap mode', async () => {
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves null rather than throwing when the lookup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(fetchAudiobookDescription('Animal Farm', 'George Orwell')).resolves.toBeNull();
  });

  it('ignores an untitled book', async () => {
    await expect(fetchAudiobookDescription('   ', 'Anon')).resolves.toBeNull();
  });
});
