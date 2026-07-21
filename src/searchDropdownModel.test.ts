import { describe, expect, it } from 'vitest';
import {
  buildSearchDropdownItems,
  clampSearchActiveIndex,
  nextSearchActiveIndex,
  prevSearchActiveIndex,
} from './searchDropdownModel';
import type { CatalogSearchResult } from './searchCatalog';
import type { SearchHistoryEntry } from './searchHistory';

const catalog: CatalogSearchResult = {
  suggestions: ['kendrick lamar'],
  artists: [{ kind: 'artist', id: 'a1', name: 'Kendrick Lamar' }],
  albums: [{ kind: 'album', id: 'al1', title: 'GNX', artist: 'Kendrick Lamar' }],
  tracks: [
    {
      kind: 'track',
      id: 't1',
      title: 'luther',
      artist: 'Kendrick Lamar',
      envelope: {
        envelopeId: 't1',
        title: 'luther',
        artist: 'Kendrick Lamar',
        url: '',
        durationSeconds: 200,
        provider: 'https',
        transport: 'element-src',
        sourceId: 't1',
      },
    },
  ],
};

const recentArtist: SearchHistoryEntry = {
  kind: 'artist',
  id: 'a0',
  name: 'Kendrick',
  at: Date.now(),
};

describe('searchDropdownModel', () => {
  it('builds ordered flat items ending with view-all', () => {
    const items = buildSearchDropdownItems({
      query: 'ken',
      recentSearches: [recentArtist],
      catalog,
      playlists: [{ kind: 'playlist', id: 'p1', name: 'Rap', trackCount: 10, isSmart: false, source: 'playlist' }],
      includeViewAll: true,
    });
    expect(items[0]).toEqual({ kind: 'recent', entry: recentArtist });
    expect(items[items.length - 1]).toEqual({ kind: 'view-all' });
    expect(items.some((i) => i.kind === 'track')).toBe(true);
  });

  it('skips duplicate catalog artist when recent history already lists them', () => {
    const items = buildSearchDropdownItems({
      query: 'future',
      recentSearches: [
        {
          kind: 'artist',
          id: 'artist-1',
          name: 'Future & Metro Boomin',
          at: Date.now(),
        },
      ],
      catalog: {
        suggestions: [],
        artists: [
          { kind: 'artist', id: 'artist-1', name: 'Future & Metro Boomin' },
          { kind: 'artist', id: 'artist-1', name: 'Future, Metro Boomin' },
        ],
        albums: [],
        tracks: [],
      },
      playlists: [],
      includeViewAll: false,
    });
    const artistItems = items.filter((item) => item.kind === 'artist');
    expect(artistItems).toHaveLength(0);
  });

  it('navigates active index within bounds', () => {
    expect(nextSearchActiveIndex(-1, 3)).toBe(0);
    expect(nextSearchActiveIndex(2, 3)).toBe(2);
    expect(prevSearchActiveIndex(0, 3)).toBe(-1);
    expect(clampSearchActiveIndex(9, 3)).toBe(2);
  });
});
