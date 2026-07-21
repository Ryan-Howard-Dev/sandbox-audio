import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProviderItem } from './catalogFetch';

const fetchCatalogApiResults = vi.fn<(url: string) => Promise<CatalogProviderItem[]>>();

vi.mock('./catalogFetch', () => ({
  fetchCatalogApiResults: (url: string) => fetchCatalogApiResults(url),
}));

vi.mock('./airGapMode', () => ({
  isAirGapEnabled: () => false,
}));

import {
  albumProviderItemsHaveTrackGaps,
  fetchAlbumTracks,
  type CatalogAlbum,
} from './searchCatalog';

function song(
  trackId: number,
  trackNumber: number,
  title: string,
  collectionId = 9001,
  collectionName = 'Slipknot (25th Anniversary Edition)',
): CatalogProviderItem {
  return {
    wrapperType: 'track',
    trackId,
    trackNumber,
    trackName: title,
    artistName: 'Slipknot',
    collectionId,
    collectionName,
    previewUrl: `https://audio.example/${trackId}.m4a`,
    trackTimeMillis: 180_000,
  };
}

function buildFullAnniversaryTracklist(): CatalogProviderItem[] {
  const tracks: CatalogProviderItem[] = [];
  for (let n = 1; n <= 32; n += 1) {
    tracks.push(song(10_000 + n, n, `Anniversary Song ${n}`));
  }
  return tracks;
}

describe('fetchAlbumTracks partial album supplement', () => {
  beforeEach(() => {
    fetchCatalogApiResults.mockReset();
  });

  it('detects sparse provider track numbers', () => {
    const partial = [
      song(1, 28, 'Twenty Eight'),
      song(2, 30, 'Thirty'),
      song(3, 31, 'Thirty One'),
    ];
    expect(albumProviderItemsHaveTrackGaps(partial, 32)).toBe(true);
    expect(albumProviderItemsHaveTrackGaps(buildFullAnniversaryTracklist(), 32)).toBe(false);
  });

  it('supplements a 4-track lookup with search when metadata promises 32 tracks', async () => {
    const fullList = buildFullAnniversaryTracklist();
    const partialLookup = fullList.filter((item) =>
      [28, 30, 31, 32].includes(item.trackNumber ?? 0),
    );

    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      if (url.includes('/lookup?')) {
        return partialLookup;
      }
      if (url.includes('/search?')) {
        return fullList;
      }
      return [];
    });

    const album: CatalogAlbum = {
      kind: 'album',
      id: 'album-slipknot-25',
      title: 'Slipknot (25th Anniversary Edition)',
      artist: 'Slipknot',
      collectionId: 9001,
      trackCount: 32,
    };

    const tracks = await fetchAlbumTracks(album);
    expect(fetchCatalogApiResults.mock.calls.length).toBeGreaterThan(1);
    expect(tracks).toHaveLength(32);
    expect(tracks[0]?.trackNumber).toBe(1);
    expect(tracks[31]?.trackNumber).toBe(32);
    expect(tracks.every((track) => track.previewUrl?.trim())).toBe(true);
  });

  it('loads collab-billed albums when opened from a primary artist page', async () => {
    const collectionId = 1676166971;
    const trackItems: CatalogProviderItem[] = [
      song(1, 1, 'Lean Beef Patty', collectionId, 'SCARING THE HOES'),
      song(2, 2, 'Garbage Pale Kids', collectionId, 'SCARING THE HOES'),
    ].map((item) => ({
      ...item,
      artistName: 'JPEGMAFIA & Danny Brown',
    }));

    fetchCatalogApiResults.mockImplementation(async (url: string) => {
      if (url.includes('/lookup?')) return trackItems;
      if (url.includes('/search?')) return trackItems;
      return [];
    });

    const album: CatalogAlbum = {
      kind: 'album',
      id: 'album-scaring',
      title: 'SCARING THE HOES',
      artist: 'JPEGMAFIA & Danny Brown',
      collectionId,
      trackCount: 14,
      releaseYear: '2023',
    };

    const tracks = await fetchAlbumTracks(album);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.title).toBe('Lean Beef Patty');
  });
});
