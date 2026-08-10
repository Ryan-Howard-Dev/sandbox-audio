import { describe, expect, it, vi } from 'vitest';
import { coverArtUrlForRelease, searchReleases, type ReleaseLookupDeps } from './releaseLookup';

const SEARCH_RESULT = {
  releases: [
    {
      id: 'rel-1',
      title: 'OK Computer',
      date: '1997-06-16',
      'artist-credit': [{ name: 'Radiohead' }],
      'track-count': 12,
    },
  ],
};

const DETAIL = {
  id: 'rel-1',
  title: 'OK Computer',
  date: '1997-06-16',
  'artist-credit': [{ name: 'Radiohead' }],
  media: [
    {
      position: 1,
      format: 'CD',
      'track-count': 2,
      tracks: [
        { title: 'Airbag', position: 1, length: 284000 },
        { title: 'Paranoid Android', position: 2, length: 383000 },
      ],
    },
  ],
};

function deps(handler: (url: string) => unknown): ReleaseLookupDeps {
  return { fetchJson: async (url) => handler(url) };
}

const happyPath = deps((url) => (url.includes('/ws/2/release?') ? SEARCH_RESULT : DETAIL));

describe('searchReleases', () => {
  it('returns a candidate with its track list', async () => {
    const result = await searchReleases({ album: 'OK Computer', artist: 'Radiohead' }, happyPath);
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    const [candidate] = result.candidates;
    expect(candidate.title).toBe('OK Computer');
    expect(candidate.artist).toBe('Radiohead');
    expect(candidate.year).toBe('1997');
    expect(candidate.tracks.map((t) => t.title)).toEqual(['Airbag', 'Paranoid Android']);
  });

  it('takes the year from any date precision the catalogue happens to have', async () => {
    for (const date of ['1997', '1997-06', '1997-06-16']) {
      const result = await searchReleases(
        { album: 'X' },
        deps((url) =>
          url.includes('/ws/2/release?')
            ? { releases: [{ id: 'r', title: 'X', date }] }
            : { id: 'r', title: 'X', date },
        ),
      );
      if (result.status !== 'found') throw new Error('expected found');
      expect(result.candidates[0].year, date).toBe('1997');
    }
  });

  it('leaves the year unset rather than inventing one from a malformed date', async () => {
    const result = await searchReleases(
      { album: 'X' },
      deps((url) =>
        url.includes('/ws/2/release?')
          ? { releases: [{ id: 'r', title: 'X', date: 'unknown' }] }
          : { id: 'r', title: 'X', date: 'unknown' },
      ),
    );
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.candidates[0].year).toBeUndefined();
  });

  it('converts track lengths from milliseconds to seconds', async () => {
    const result = await searchReleases({ album: 'OK Computer' }, happyPath);
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.candidates[0].tracks[0].durationSeconds).toBe(284);
  });

  it('numbers discs from the medium, so a two disc release stays apart', async () => {
    const twoDiscs = {
      id: 'rel-2',
      title: 'Anthology',
      media: [
        { position: 1, tracks: [{ title: 'One', position: 1 }] },
        { position: 2, tracks: [{ title: 'Two', position: 1 }] },
      ],
    };
    const result = await searchReleases(
      { album: 'Anthology' },
      deps((url) =>
        url.includes('/ws/2/release?') ? { releases: [{ id: 'rel-2', title: 'Anthology' }] } : twoDiscs,
      ),
    );
    if (result.status !== 'found') throw new Error('expected found');
    const discs = result.candidates[0].tracks.map((t) => t.discNumber);
    expect(discs).toEqual([1, 2]);
  });

  it('says empty rather than searching for nothing', async () => {
    const fetchJson = vi.fn();
    const result = await searchReleases({ album: '   ' }, { fetchJson });
    expect(result.status).toBe('empty');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('separates a catalogue with nothing from a catalogue that could not be asked', async () => {
    // These want different things from the person searching: change the words, or try again later.
    const none = await searchReleases({ album: 'X' }, deps(() => ({ releases: [] })));
    expect(none.status).toBe('none');

    const offline = await searchReleases(
      { album: 'X' },
      {
        fetchJson: async () => {
          throw new Error('network');
        },
      },
    );
    expect(offline.status).toBe('unavailable');
  });

  it('keeps a candidate whose detail could not be fetched, without its tracks', async () => {
    // Album, artist and year are all in the search result already; dropping the row would hide a
    // real match because one request failed.
    const result = await searchReleases(
      { album: 'OK Computer' },
      deps((url) => {
        if (url.includes('/ws/2/release?')) return SEARCH_RESULT;
        throw new Error('detail failed');
      }),
    );
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].tracks).toEqual([]);
    expect(result.candidates[0].title).toBe('OK Computer');
  });

  it('quotes the album so a title with its own quotes cannot break the query', async () => {
    let searchUrl = '';
    await searchReleases(
      { album: 'The "Best" Of' },
      deps((url) => {
        if (url.includes('/ws/2/release?')) {
          searchUrl = url;
          return { releases: [] };
        }
        return {};
      }),
    );
    expect(searchUrl).toContain('release%3A%22The%20Best%20Of%22');
  });

  it('caps how many releases it will fetch detail for', async () => {
    let detailCalls = 0;
    await searchReleases(
      { album: 'X', limit: 99 },
      deps((url) => {
        if (url.includes('/ws/2/release?')) {
          expect(url).toContain('limit=10');
          return { releases: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, title: 'X' })) };
        }
        detailCalls += 1;
        return { id: 'r', title: 'X' };
      }),
    );
    expect(detailCalls).toBe(10);
  });
});

describe('coverArtUrlForRelease', () => {
  it('builds the archive url by convention rather than another request', () => {
    expect(coverArtUrlForRelease('rel-1')).toBe(
      'https://coverartarchive.org/release/rel-1/front-500',
    );
  });
});
