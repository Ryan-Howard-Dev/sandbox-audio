import { describe, expect, it } from 'vitest';
import type { CatalogProviderItem } from './catalogFetch';
import {
  coverArtistMatches,
  coverTitlesMatch,
  discogsSearchPageUrl,
  extractUntitledStreamUrl,
  lastFmAlbumPageUrl,
  lastFmPathSegment,
  pickCatalogCoverItem,
  youtubeThumbUrl,
} from './albumCoverProviders';

describe('coverTitlesMatch', () => {
  it('matches deluxe and standard variants of the same album', () => {
    expect(coverTitlesMatch('We Don\'t Trust You (Deluxe)', 'We Don\'t Trust You')).toBe(true);
  });

  it('rejects unrelated titles', () => {
    expect(coverTitlesMatch('DS4EVER', 'Heroes & Villains')).toBe(false);
  });

  it('matches Rebel case-insensitively', () => {
    expect(coverTitlesMatch('REBEL', 'Rebel')).toBe(true);
  });
});

describe('coverArtistMatches', () => {
  it('matches stylized EsDeeKid spellings', () => {
    expect(coverArtistMatches('EsDeeKid', 'ESDEEKID')).toBe(true);
  });

  it('rejects Anne Wilson for EsDeeKid', () => {
    expect(coverArtistMatches('Anne Wilson', 'EsDeeKid')).toBe(false);
  });
});

describe('pickCatalogCoverItem', () => {
  const anneWilsonRebel: CatalogProviderItem = {
    collectionName: 'REBEL',
    artistName: 'Anne Wilson',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/anne-rebel.jpg/100x100bb.jpg',
    releaseDate: '2024-04-19T07:00:00Z',
  };

  const esdeekidRebel: CatalogProviderItem = {
    collectionName: 'Rebel',
    artistName: 'EsDeeKid',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/esdeekid-rebel.jpg/100x100bb.jpg',
    releaseDate: '2025-01-01T07:00:00Z',
  };

  it('rejects Anne Wilson REBEL when artist is EsDeeKid', () => {
    const picked = pickCatalogCoverItem([anneWilsonRebel], 'Rebel', 'EsDeeKid');
    expect(picked).toBeNull();
  });

  it('picks the EsDeeKid row when both are present', () => {
    const picked = pickCatalogCoverItem(
      [anneWilsonRebel, esdeekidRebel],
      'Rebel',
      'EsDeeKid',
    );
    expect(picked?.artistName).toBe('EsDeeKid');
  });

  it('does not fall back to first result without artist match', () => {
    const picked = pickCatalogCoverItem([anneWilsonRebel], 'Rebel', 'EsDeeKid');
    expect(picked).toBeNull();
  });
});

describe('extractUntitledStreamUrl', () => {
  it('pulls untitled.stream URLs from album or artist metadata', () => {
    expect(
      extractUntitledStreamUrl(
        'https://untitled.stream/album/abc123',
        'Some Artist',
      ),
    ).toBe('https://untitled.stream/album/abc123');
  });

  it('returns null when no untitled URL is present', () => {
    expect(extractUntitledStreamUrl('DS4EVER', 'Gunna')).toBeNull();
  });
});

describe('youtubeThumbUrl', () => {
  it('builds hqdefault thumbnail URLs', () => {
    expect(youtubeThumbUrl('dQw4w9WgXcQ')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });
});

describe('lastFmAlbumPageUrl', () => {
  it('builds public album page URLs without an API key', () => {
    expect(lastFmPathSegment('Future & Metro Boomin')).toBe('Future+%26+Metro+Boomin');
    expect(lastFmAlbumPageUrl('Future', "We Don't Trust You")).toBe(
      "https://www.last.fm/music/Future/We+Don't+Trust+You",
    );
  });
});

describe('discogsSearchPageUrl', () => {
  it('builds public search URLs without a token', () => {
    expect(discogsSearchPageUrl('DS4EVER', 'Gunna')).toBe(
      'https://www.discogs.com/search/?q=Gunna%20DS4EVER&type=release',
    );
  });
});

describe('buildCoverProviderChain', () => {
  it('places iTunes catalog after Deezer and Discogs', async () => {
    const {
      buildCoverProviderChain,
      fromMusicBrainz,
      fromDeezer,
      fromDiscogs,
      fromCatalogProvider,
    } = await import('./albumCoverProviders');
    const chain = buildCoverProviderChain();
    expect(chain.indexOf(fromMusicBrainz)).toBe(0);
    expect(chain.indexOf(fromDeezer)).toBeLessThan(chain.indexOf(fromCatalogProvider));
    expect(chain.indexOf(fromDiscogs)).toBeLessThan(chain.indexOf(fromCatalogProvider));
  });
});
