import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProviderItem } from './catalogFetch';

vi.mock('./airGapMode', () => ({
  isAirGapEnabled: vi.fn(() => false),
}));

vi.mock('./artistImage', () => ({
  findArtistImage: vi.fn(async () => undefined),
}));

vi.mock('./lockerStorage', () => ({
  getLockerEntries: vi.fn(async () => []),
  artistLineContainsLeakWatermark: vi.fn(() => false),
  isLeakWatermarkArtistName: vi.fn(() => false),
  isUsableArtistName: vi.fn(() => true),
}));

vi.mock('./tier34/client', () => ({
  tier34SearchLocker: vi.fn(async () => []),
}));

vi.mock('./responseCache', () => ({
  CACHE_KEYS: { ARTIST_DISCOGRAPHY: 'sandbox_artist_discography_cache_v3' },
  prefixedCacheKey: (_prefix: string, part: string) => `cache:${part}`,
  readResponseCache: vi.fn(() => null),
  writeResponseCache: vi.fn(),
}));

const fetchCatalogApiResults = vi.fn<(url: string) => Promise<CatalogProviderItem[]>>();

vi.mock('./catalogFetch', () => ({
  fetchCatalogApiResults: (url: string) => fetchCatalogApiResults(url),
}));

import {
  catalogArtistNamesEquivalent,
  catalogDisplayArtistName,
  catalogSingleDedupeKey,
  clearArtistDiscographySessionCacheForTests,
  dedupeCatalogSingles,
  dropSparseMbAlbumGhosts,
  fetchArtistDiscography,
  fetchArtistTopTracks,
} from './searchCatalog';
import { readResponseCache } from './responseCache';

const KANYE_WEST_ID = 2715720;
const YE_ID = 1714710847;
const KANYE_OMARI_ID = 6776577113;

const kanyeAlbum: CatalogProviderItem = {
  wrapperType: 'collection',
  collectionType: 'Album',
  artistId: KANYE_WEST_ID,
  collectionId: 1412872568,
  artistName: 'Kanye West',
  collectionName: 'The College Dropout',
  trackCount: 21,
  releaseDate: '2004-02-10T08:00:00Z',
};

const kanyeSong: CatalogProviderItem = {
  wrapperType: 'track',
  kind: 'song',
  artistId: KANYE_WEST_ID,
  trackId: 123,
  artistName: 'Kanye West',
  collectionName: 'The College Dropout',
  trackName: 'Through the Wire',
  previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a',
  trackTimeMillis: 221000,
};

function parseCatalogUrl(url: string): {
  id: string | null;
  entity: string | null;
  term: string | null;
} {
  const parsed = new URL(url, 'http://local');
  return {
    id: parsed.searchParams.get('id'),
    entity: parsed.searchParams.get('entity'),
    term: parsed.searchParams.get('term'),
  };
}

describe('catalogArtistNamesEquivalent', () => {
  it('treats Ye and Kanye West as the same artist', () => {
    expect(catalogArtistNamesEquivalent('Ye', 'Kanye West')).toBe(true);
    expect(catalogArtistNamesEquivalent('Kanye Omari West', 'Kanye West')).toBe(true);
  });

  it('treats EsDeeKid spelling variants as the same artist', () => {
    expect(catalogArtistNamesEquivalent('Esdeekid', 'EsDeeKid')).toBe(true);
    expect(catalogArtistNamesEquivalent('Esdee Kid', 'EsDeeKid')).toBe(true);
    expect(catalogArtistNamesEquivalent('ESD EEKID', 'EsDeeKid')).toBe(true);
  });

  it('does not equate unrelated artists', () => {
    expect(catalogArtistNamesEquivalent('Drake', 'Kanye West')).toBe(false);
  });
});

describe('catalogDisplayArtistName', () => {
  it('shows Kanye West for billing duplicate names', () => {
    expect(catalogDisplayArtistName('Kanye Omari West')).toBe('Kanye West');
    expect(catalogDisplayArtistName('KANYE OMARI WEST')).toBe('Kanye West');
    expect(catalogDisplayArtistName('Ye')).toBe('Kanye West');
  });

  it('leaves unrelated artist names unchanged', () => {
    expect(catalogDisplayArtistName('Drake')).toBe('Drake');
  });

  it('uses only the first billed artist for collaboration credits', () => {
    expect(catalogDisplayArtistName('Metro Boomin, James Blake, A$AP Rocky & 21 Savage')).toBe(
      'Metro Boomin',
    );
    expect(catalogDisplayArtistName('Future & Metro Boomin')).toBe('Future');
    expect(catalogDisplayArtistName('Drake feat. 21 Savage')).toBe('Drake');
  });
});

describe('fetchArtistDiscography Kanye West', () => {
  beforeEach(() => {
    fetchCatalogApiResults.mockReset();
    vi.mocked(readResponseCache).mockReturnValue(null);
    clearArtistDiscographySessionCacheForTests();
  });

  it('re-resolves when cached artist id is a sparse duplicate billing', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);

      if (id === String(KANYE_OMARI_ID) && entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_OMARI_ID,
            artistName: 'Kanye Omari West',
          },
        ];
      }
      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
        ];
      }
      if (id === String(KANYE_OMARI_ID) && entity === 'album') {
        return [
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: KANYE_OMARI_ID,
            collectionId: 6776599323,
            artistName: 'Kanye Omari West',
            collectionName: 'Pure (bonus track) - Single',
            trackCount: 1,
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
          kanyeAlbum,
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [kanyeSong];
      }
      return [];
    });

    const disc = await fetchArtistDiscography(
      'Kanye West',
      `artist-${KANYE_OMARI_ID}`,
    );

    expect(disc.albums.length).toBeGreaterThan(0);
    expect(disc.albums[0]?.title).toBe('The College Dropout');
    expect(disc.catalogUnreachable).toBe(false);

    const albumLookups = fetchCatalogApiResults.mock.calls
      .map(([url]) => parseCatalogUrl(url))
      .filter(({ entity }) => entity === 'album');
    expect(albumLookups.some(({ id }) => id === String(KANYE_WEST_ID))).toBe(true);
    expect(albumLookups.every(({ id }) => id !== String(KANYE_OMARI_ID))).toBe(true);
  });

  it('maps artist-6776577113 to canonical catalog id 2715720 before fetch', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);
      if (id === String(KANYE_OMARI_ID)) {
        throw new Error('sparse billing id must not be queried');
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [kanyeAlbum];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [kanyeSong];
      }
      return [];
    });

    const disc = await fetchArtistDiscography(
      'Kanye Omari West',
      `artist-${KANYE_OMARI_ID}`,
    );
    expect(disc.albums.length).toBeGreaterThan(0);
    expect(disc.albums[0]?.title).toBe('The College Dropout');
  });

  it('ignores a fresh empty persisted cache and re-fetches catalog', async () => {
    vi.mocked(readResponseCache).mockReturnValueOnce({
      data: { albums: [], singles: [] },
      fetchedAt: Date.now(),
      isFresh: true,
      isStale: false,
    });

    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);

      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [kanyeAlbum];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [kanyeSong];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Kanye West', `artist-${KANYE_WEST_ID}`);
    expect(disc.albums.length).toBeGreaterThan(0);
    expect(disc.albums[0]?.title).toBe('The College Dropout');
  });

  it('loads albums when drill-down uses Ye id with Kanye West display name', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);

      if (id === String(YE_ID)) {
        throw new Error('Ye billing id must canonicalize to Kanye West catalog id');
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
          kanyeAlbum,
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [kanyeSong];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Kanye West', `artist-${YE_ID}`);
    expect(disc.albums.length).toBeGreaterThan(0);
  });
});

describe('fetchArtistTopTracks Kanye West', () => {
  beforeEach(() => {
    fetchCatalogApiResults.mockReset();
    vi.mocked(readResponseCache).mockReturnValue(null);
    clearArtistDiscographySessionCacheForTests();
  });

  it('returns catalog tracks after sparse duplicate id re-resolution', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);

      if (id === String(KANYE_OMARI_ID) && entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_OMARI_ID,
            artistName: 'Kanye Omari West',
          },
        ];
      }
      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
        ];
      }
      if (id === String(KANYE_OMARI_ID) && entity === 'album') {
        return [
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: KANYE_OMARI_ID,
            collectionId: 6776599323,
            artistName: 'Kanye Omari West',
            collectionName: 'Pure (bonus track) - Single',
            trackCount: 1,
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [kanyeSong];
      }
      return [];
    });

    const tracks = await fetchArtistTopTracks(
      'Kanye West',
      `artist-${KANYE_OMARI_ID}`,
      10,
    );
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]?.title).toBe('Through the Wire');
  });
});

describe('fetchArtistDiscography album vs single classification', () => {
  beforeEach(() => {
    fetchCatalogApiResults.mockReset();
    vi.mocked(readResponseCache).mockReturnValue(null);
    clearArtistDiscographySessionCacheForTests();
  });

  it('routes 1-track Album-type releases to Singles, not Albums grid', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);
      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [
          kanyeAlbum,
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: KANYE_WEST_ID,
            collectionId: 1555555555,
            artistName: 'Kanye West',
            collectionName: 'HURRICANE - Single',
            trackCount: 1,
            releaseDate: '2021-08-29T07:00:00Z',
          },
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: KANYE_WEST_ID,
            collectionId: 1555555556,
            artistName: 'Kanye West',
            collectionName: 'CARNIVAL - Single',
            trackCount: 1,
            releaseDate: '2024-02-08T08:00:00Z',
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'song') {
        return [];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Kanye West', `artist-${KANYE_WEST_ID}`);
    expect(disc.albums.map((a) => a.title)).toEqual(['The College Dropout']);
    expect(disc.singles.map((s) => s.title).sort()).toEqual(['CARNIVAL', 'HURRICANE']);
  });

  it('keeps collab albums from iTunes artist lookup when solo discography is large', async () => {
    const DANNY_BROWN_ID = 217291005;
    const soloAlbum = (collectionId: number, title: string): CatalogProviderItem => ({
      wrapperType: 'collection',
      collectionType: 'Album',
      artistId: DANNY_BROWN_ID,
      collectionId,
      artistName: 'Danny Brown',
      collectionName: title,
      trackCount: 12,
      releaseDate: '2016-01-01T08:00:00Z',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/solo.jpg',
    });
    const scaringTheHoes: CatalogProviderItem = {
      wrapperType: 'collection',
      collectionType: 'Album',
      artistId: DANNY_BROWN_ID,
      collectionId: 1676166971,
      artistName: 'JPEGMAFIA & Danny Brown',
      collectionName: 'SCARING THE HOES',
      trackCount: 14,
      releaseDate: '2023-03-24T07:00:00Z',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/scaring.jpg',
    };

    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);
      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: DANNY_BROWN_ID,
            artistName: 'Danny Brown',
          },
        ];
      }
      if (id === String(DANNY_BROWN_ID) && entity === 'album') {
        return [
          soloAlbum(1001, 'Atrocity Exhibition'),
          soloAlbum(1002, 'uknowhatimsayin¿'),
          scaringTheHoes,
        ];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Danny Brown', `artist-${DANNY_BROWN_ID}`);
    const scaring = disc.albums.find((a) => a.title === 'SCARING THE HOES');
    expect(scaring).toBeDefined();
    expect(scaring?.trackCount).toBe(14);
    expect(scaring?.artworkUrl).toContain('scaring.jpg');
    expect(scaring?.collectionId).toBe(1676166971);
  });

  it('keeps multi-track EPs in Albums', async () => {
    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { id, entity } = parseCatalogUrl(url);
      if (entity === 'musicArtist') {
        return [
          {
            wrapperType: 'artist',
            artistId: KANYE_WEST_ID,
            artistName: 'Kanye West',
          },
        ];
      }
      if (id === String(KANYE_WEST_ID) && entity === 'album') {
        return [
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: KANYE_WEST_ID,
            collectionId: 1666666666,
            artistName: 'Kanye West',
            collectionName: 'Kids See Ghosts - EP',
            trackCount: 7,
            releaseDate: '2018-06-08T07:00:00Z',
          },
        ];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Kanye West', `artist-${KANYE_WEST_ID}`);
    expect(disc.albums.map((a) => a.title)).toContain('Kids See Ghosts - EP');
    expect(disc.singles).toHaveLength(0);
  });

  it('dedupes singles by normalized title+artist and keeps best artwork', () => {
    const deduped = dedupeCatalogSingles([
      {
        kind: 'track',
        id: 'a',
        title: 'CITY OF GODS',
        artist: 'Kanye West',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
      },
      {
        kind: 'track',
        id: 'b',
        title: 'City of Gods - Single',
        artist: 'Kanye West',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/600x600bb.jpg',
        envelope: {
          envelopeId: 'catalog-1',
          title: 'CITY OF GODS',
          artist: 'Kanye West',
          url: 'https://audio.example/preview.m4a',
          durationSeconds: 180,
          provider: 'https',
          transport: 'element-src',
          sourceId: 'catalog-test',
        },
      },
      {
        kind: 'track',
        id: 'c',
        title: 'CITY OF GODS',
        artist: 'Ye',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.title).toBe('City of Gods - Single');
    expect(deduped[0]?.artworkUrl).toContain('600x600');
    expect(catalogSingleDedupeKey('Kanye West', 'CITY OF GODS')).toBe(
      catalogSingleDedupeKey('Ye', 'City of Gods - Single'),
    );
  });

  it('drops sparse MusicBrainz album ghosts when a fuller iTunes sibling exists', () => {
    const albums = dropSparseMbAlbumGhosts([
      {
        kind: 'album',
        id: 'mb-rg-ghost',
        title: 'SCARING THE HOES',
        artist: 'Danny Brown',
        releaseYear: '2023',
      },
      {
        kind: 'album',
        id: 'catalog-1676166971',
        title: 'SCARING THE HOES',
        artist: 'JPEGMAFIA & Danny Brown',
        collectionId: 1676166971,
        trackCount: 14,
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/scaring.jpg',
        releaseYear: '2023',
      },
    ]);
    expect(albums).toHaveLength(1);
    expect(albums[0]?.collectionId).toBe(1676166971);
    expect(albums[0]?.trackCount).toBe(14);
  });

  it('keeps billed collab albums when artist id lookup fails', async () => {
    const scaringTheHoes: CatalogProviderItem = {
      wrapperType: 'collection',
      collectionType: 'Album',
      collectionId: 1676166971,
      artistName: 'JPEGMAFIA & Danny Brown',
      collectionName: 'SCARING THE HOES',
      trackCount: 14,
      releaseDate: '2023-03-24T07:00:00Z',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/scaring.jpg',
    };

    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      const { term, entity } = parseCatalogUrl(url);
      if (entity === 'musicArtist') return [];
      if (entity === 'album' && term?.toLowerCase() === 'danny brown') {
        return [
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            collectionId: 1001,
            artistName: 'Danny Brown',
            collectionName: 'Atrocity Exhibition',
            trackCount: 12,
            releaseDate: '2016-01-01T08:00:00Z',
          },
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            collectionId: 1002,
            artistName: 'Danny Brown',
            collectionName: 'uknowhatimsayin¿',
            trackCount: 11,
            releaseDate: '2019-01-01T08:00:00Z',
          },
          scaringTheHoes,
        ];
      }
      return [];
    });

    const disc = await fetchArtistDiscography('Danny Brown');
    const scaring = disc.albums.find((a) => a.title === 'SCARING THE HOES');
    expect(scaring).toBeDefined();
    expect(scaring?.trackCount).toBe(14);
    expect(scaring?.artworkUrl).toContain('scaring.jpg');
  });
});
