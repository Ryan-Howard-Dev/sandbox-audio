import { describe, expect, it } from 'vitest';
import {
  albumTitlesAreExclusiveVariants,
  albumTitlesFuzzyMatch,
  catalogAlbumIdentityKey,
  collectAlbumArtistCredits,
  collectAlbumGuestArtists,
  dedupeAlbumTracklist,
  dedupeCatalogAlbums,
  formatCappedArtistList,
  groupCatalogTracksByDisc,
  normalizeCatalogArtistKey,
  type CatalogAlbum,
  type CatalogTrack,
} from './searchCatalog';

describe('album title matching', () => {
  it('does not merge WE DON\'T TRUST YOU with WE STILL DON\'T TRUST YOU', () => {
    const first = "WE DON'T TRUST YOU";
    const second = "WE STILL DON'T TRUST YOU";
    expect(albumTitlesAreExclusiveVariants(first, second)).toBe(true);
    expect(albumTitlesFuzzyMatch(first, second)).toBe(false);
  });

  it('does not treat WE STILL DON\'T TRUST YOU as a relevance match for WE DON\'T TRUST YOU', () => {
    const first = "WE DON'T TRUST YOU";
    const second = "WE STILL DON'T TRUST YOU";
    expect(albumTitlesFuzzyMatch(first, second)).toBe(false);
    expect(albumTitlesAreExclusiveVariants(first, second)).toBe(true);
  });

  it('still matches edition variants of the same album', () => {
    expect(albumTitlesFuzzyMatch("GNX", 'GNX (Deluxe)')).toBe(true);
  });
});

describe('catalog dedupe keys', () => {
  it('normalizes collab artist billing variants', () => {
    expect(normalizeCatalogArtistKey('Future & Metro Boomin')).toBe(
      normalizeCatalogArtistKey('Future, Metro Boomin'),
    );
  });

  it('dedupes albums with collab artist spelling variants', () => {
    const albums: CatalogAlbum[] = [
      {
        kind: 'album',
        id: 'album-1',
        title: "WE DON'T TRUST YOU",
        artist: 'Future & Metro Boomin',
        releaseYear: '2024',
        trackCount: 18,
      },
      {
        kind: 'album',
        id: 'album-2',
        title: "WE DON'T TRUST YOU",
        artist: 'Future, Metro Boomin',
        releaseYear: '2024',
        trackCount: 18,
      },
    ];
    const deduped = dedupeCatalogAlbums(albums);
    expect(deduped).toHaveLength(1);
    expect(catalogAlbumIdentityKey(albums[0]!.artist, albums[0]!.title)).toBe(
      catalogAlbumIdentityKey(albums[1]!.artist, albums[1]!.title),
    );
  });

  it('keeps deluxe and standard as separate album tiles', () => {
    const albums: CatalogAlbum[] = [
      {
        kind: 'album',
        id: 'album-1',
        title: 'FUTURE',
        artist: 'Future',
        collectionId: 1001,
        releaseYear: '2017',
        trackCount: 17,
      },
      {
        kind: 'album',
        id: 'album-2',
        title: 'FUTURE (Deluxe Edition)',
        artist: 'Future',
        collectionId: 1002,
        releaseYear: '2017',
        trackCount: 20,
      },
    ];
    expect(dedupeCatalogAlbums(albums)).toHaveLength(2);
  });

  it('collapses obvious partial releases when a much fuller sibling exists', () => {
    const albums: CatalogAlbum[] = [
      {
        kind: 'album',
        id: 'album-deluxe',
        title: 'BULLY - DELUXE',
        artist: 'Kanye West',
        collectionId: 3001,
        releaseYear: '2026',
        trackCount: 32,
      },
      {
        kind: 'album',
        id: 'album-partial',
        title: 'BULLY',
        artist: 'Kanye West',
        collectionId: 3002,
        releaseYear: '2026',
        trackCount: 4,
      },
      {
        kind: 'album',
        id: 'album-standard',
        title: 'BULLY',
        artist: 'Kanye West',
        collectionId: 3003,
        releaseYear: '2026',
        trackCount: 18,
      },
    ];
    const deduped = dedupeCatalogAlbums(albums);
    expect(deduped).toHaveLength(2);
    expect(deduped.some((a) => a.trackCount === 4)).toBe(false);
    expect(deduped.some((a) => a.trackCount === 32)).toBe(true);
    expect(deduped.some((a) => a.trackCount === 18)).toBe(true);
  });
});

describe('album disc grouping and artist credits', () => {
  const mkTrack = (overrides: Partial<CatalogTrack>): CatalogTrack => ({
    kind: 'track',
    id: 'track-1',
    title: 'Track',
    artist: 'Future, Metro Boomin',
    ...overrides,
  });

  it('groups multi-disc albums into Volume sections', () => {
    const tracks = [
      mkTrack({ id: 'track-1', title: 'A', discNumber: 1, trackNumber: 1 }),
      mkTrack({ id: 'track-2', title: 'B', discNumber: 1, trackNumber: 2 }),
      mkTrack({ id: 'track-3', title: 'C', discNumber: 2, trackNumber: 1 }),
    ];
    const sections = groupCatalogTracksByDisc(tracks, "WE STILL DON'T TRUST YOU");
    expect(sections).toHaveLength(2);
    expect(sections[0]!.label).toBe('Volume 1');
    expect(sections[1]!.label).toBe('Volume 2');
    expect(sections[0]!.tracks).toHaveLength(2);
    expect(sections[1]!.tracks).toHaveLength(1);
  });

  it('infers volume split when track numbers reset but discNumber is missing', () => {
    const tracks = [
      mkTrack({ id: 'track-1', title: 'A', trackNumber: 17 }),
      mkTrack({ id: 'track-2', title: 'B', trackNumber: 18 }),
      mkTrack({ id: 'track-3', title: 'C', trackNumber: 1 }),
      mkTrack({ id: 'track-4', title: 'D', trackNumber: 2 }),
    ];
    const sections = groupCatalogTracksByDisc(tracks, "WE STILL DON'T TRUST YOU");
    expect(sections).toHaveLength(2);
    expect(sections[1]!.label).toBe('Volume 2');
  });

  it('collects featured artists from track billing', () => {
    const credits = collectAlbumArtistCredits('Future, Metro Boomin', [
      mkTrack({ artist: 'Future, Metro Boomin, Lil Baby' }),
      mkTrack({ artist: 'Future, Metro Boomin, A$AP Rocky' }),
    ]);
    expect(credits).toEqual(['Future', 'Metro Boomin', 'Lil Baby', 'A$AP Rocky']);
  });

  it('collects featured artists from track titles when iTunes omits per-track billing', () => {
    const credits = collectAlbumArtistCredits('Kanye West', [
      mkTrack({ title: 'Hurricane', artist: 'Kanye West' }),
      mkTrack({ title: 'Jail (feat. Jay-Z)', artist: 'Kanye West' }),
      mkTrack({ title: 'Off The Grid (feat. Playboi Carti)', artist: 'Kanye West' }),
      mkTrack({ title: 'Praise God (feat. Travis Scott & Baby Keem)', artist: 'Kanye West' }),
    ]);
    expect(credits).toEqual([
      'Kanye West',
      'Jay-Z',
      'Playboi Carti',
      'Travis Scott',
      'Baby Keem',
    ]);
  });

  it('collects featured artists from locker trackSoloists when iTunes billing is sparse', () => {
    const credits = collectAlbumArtistCredits('Kanye West', [
      {
        title: 'Jail',
        artist: 'Kanye West',
        trackSoloists: 'Jay-Z, Sunday Service Choir',
      },
      {
        title: 'Hurricane',
        artist: 'Kanye West',
        trackSoloists: 'Lil Baby, The Weeknd',
      },
    ]);
    expect(credits).toEqual([
      'Kanye West',
      'Jay-Z',
      'Sunday Service Choir',
      'Lil Baby',
      'The Weeknd',
    ]);
  });

  it('caps long featuring lists for album headers', () => {
    const guests = collectAlbumGuestArtists('Kanye West', [
      mkTrack({ title: 'A (feat. Artist 1)', artist: 'Kanye West' }),
      mkTrack({ title: 'B (feat. Artist 2)', artist: 'Kanye West' }),
      mkTrack({ title: 'C (feat. Artist 3)', artist: 'Kanye West' }),
      mkTrack({ title: 'D (feat. Artist 4)', artist: 'Kanye West' }),
      mkTrack({ title: 'E (feat. Artist 5)', artist: 'Kanye West' }),
      mkTrack({ title: 'F (feat. Artist 6)', artist: 'Kanye West' }),
      mkTrack({ title: 'G (feat. Artist 7)', artist: 'Kanye West' }),
      mkTrack({ title: 'H (feat. Artist 8)', artist: 'Kanye West' }),
      mkTrack({ title: 'I (feat. Artist 9)', artist: 'Kanye West' }),
    ]);
    expect(guests).toHaveLength(9);
    const { visible, overflow } = formatCappedArtistList(guests);
    expect(visible).toHaveLength(8);
    expect(overflow).toBe(1);
  });
});

describe('dedupeAlbumTracklist', () => {
  const base = (overrides: Partial<CatalogTrack>): CatalogTrack => ({
    kind: 'track',
    id: 'track-1',
    title: "Don't Come Out the House",
    artist: 'Metro Boomin',
    album: 'NOT ALL HEROES WEAR CAPES',
    durationSeconds: 168,
    ...overrides,
  });

  it('does not collapse different track numbers that share a title prefix', () => {
    const tracks = dedupeAlbumTracklist([
      base({ id: 'track-100', title: 'Anniversary Song 1', trackNumber: 1 }),
      base({ id: 'track-101', title: 'Anniversary Song 10', trackNumber: 10 }),
      base({ id: 'track-102', title: 'Anniversary Song 11', trackNumber: 11 }),
    ]);
    expect(tracks).toHaveLength(3);
  });

  it('collapses duplicate catalog rows with different track ids', () => {
    const tracks = dedupeAlbumTracklist([
      base({ id: 'track-100', trackNumber: 5 }),
      base({
        id: 'track-200',
        trackNumber: 5,
        title: "Don't Come Out the House (feat. 21 Savage)",
      }),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.title).toBe("Don't Come Out the House");
  });

  it('keeps instrumental versions separate from album versions', () => {
    const tracks = dedupeAlbumTracklist([
      base({ id: 'track-300', title: 'Dreamcatcher', trackNumber: 7 }),
      base({ id: 'track-301', title: 'Dreamcatcher (Instrumental)', trackNumber: 8 }),
    ]);
    expect(tracks).toHaveLength(2);
  });
});
