import { describe, expect, it } from 'vitest';
import {
  catalogAlbumVersionGroupKey,
  catalogAlbumVersionLabel,
  listCatalogAlbumEditions,
  type CatalogAlbum,
} from './searchCatalog';

function mkAlbum(overrides: Partial<CatalogAlbum> = {}): CatalogAlbum {
  return {
    kind: 'album',
    id: 'album-1',
    title: 'The College Dropout',
    artist: 'Kanye West',
    releaseYear: '2004',
    ...overrides,
  };
}

describe('catalogAlbumVersionGroupKey', () => {
  it('groups plain and deluxe titles with the same base name', () => {
    const standard = mkAlbum({ title: 'DONDA', collectionId: 1 });
    const deluxe = mkAlbum({
      id: 'album-2',
      title: 'DONDA (Deluxe Edition)',
      collectionId: 2,
    });
    expect(catalogAlbumVersionGroupKey(standard)).toBe(
      catalogAlbumVersionGroupKey(deluxe),
    );
  });
});

describe('catalogAlbumVersionLabel', () => {
  const collegeDropoutExplicit = mkAlbum({
    id: 'album-explicit',
    contentRating: 'explicit',
    collectionId: 1440742908,
    trackCount: 21,
  });
  const collegeDropoutClean = mkAlbum({
    id: 'album-clean',
    contentRating: 'clean',
    collectionId: 1440742910,
    trackCount: 21,
  });
  const collegeDropoutContext = [collegeDropoutExplicit, collegeDropoutClean];

  it('labels explicit and clean editions that share the same title', () => {
    expect(
      catalogAlbumVersionLabel(collegeDropoutExplicit, collegeDropoutContext),
    ).toBe('Explicit');
    expect(
      catalogAlbumVersionLabel(collegeDropoutClean, collegeDropoutContext),
    ).toBe('Clean');
  });

  it('hides labels when no sibling editions appear in the grid', () => {
    expect(catalogAlbumVersionLabel(collegeDropoutExplicit)).toBe('Explicit');
    expect(
      catalogAlbumVersionLabel(collegeDropoutExplicit, [collegeDropoutExplicit]),
    ).toBeNull();
  });

  it('disambiguates DONDA explicit vs clean duplicates', () => {
    const dondaExplicit = mkAlbum({
      id: 'donda-e',
      title: 'DONDA',
      artist: 'Kanye West',
      releaseYear: '2021',
      contentRating: 'explicit',
      collectionId: 1584281467,
      trackCount: 27,
    });
    const dondaClean = mkAlbum({
      id: 'donda-c',
      title: 'DONDA',
      artist: 'Kanye West',
      releaseYear: '2021',
      contentRating: 'clean',
      collectionId: 1584281470,
      trackCount: 27,
    });
    const context = [dondaExplicit, dondaClean];

    expect(catalogAlbumVersionLabel(dondaExplicit, context)).toBe('Explicit');
    expect(catalogAlbumVersionLabel(dondaClean, context)).toBe('Clean');
  });

  it('shows track-count delta when siblings differ in length', () => {
    const standard = mkAlbum({
      id: 'album-standard',
      title: 'DONDA',
      trackCount: 27,
      contentRating: 'explicit',
      collectionId: 1,
    });
    const deluxe = mkAlbum({
      id: 'album-deluxe',
      title: 'DONDA (Deluxe Edition)',
      trackCount: 31,
      contentRating: 'explicit',
      collectionId: 2,
    });
    const context = [standard, deluxe];

    expect(catalogAlbumVersionLabel(standard, context)).toBe('27 tracks · Explicit');
    expect(catalogAlbumVersionLabel(deluxe, context)).toBe('31 tracks · Explicit');
  });

  it('falls back to Standard when siblings exist but metadata is missing', () => {
    const a = mkAlbum({ id: 'a', collectionId: 10, trackCount: 21 });
    const b = mkAlbum({ id: 'b', collectionId: 11, trackCount: 21 });
    expect(catalogAlbumVersionLabel(a, [a, b])).toBe('Standard');
    expect(catalogAlbumVersionLabel(b, [a, b])).toBe('Standard');
  });

  it('does not repeat deluxe in version label when sibling title differs', () => {
    const standard = mkAlbum({
      id: 'future-standard',
      title: 'FUTURE',
      artist: 'Future',
      releaseYear: '2017',
      collectionId: 1001,
    });
    const deluxe = mkAlbum({
      id: 'future-deluxe',
      title: 'FUTURE (Deluxe Edition)',
      artist: 'Future',
      releaseYear: '2017',
      collectionId: 1002,
    });
    const context = [standard, deluxe];

    expect(catalogAlbumVersionLabel(deluxe, context)).toBe('Standard');
    expect(catalogAlbumVersionLabel(standard, context)).toBe('Standard');
  });

  it('returns null when no edition signal exists and no siblings', () => {
    expect(catalogAlbumVersionLabel(mkAlbum())).toBeNull();
    expect(catalogAlbumVersionLabel(mkAlbum(), [mkAlbum()])).toBeNull();
  });
});

describe('listCatalogAlbumEditions explicitness back-fill', () => {
  it('restores explicit rating when a ratingless locker edition wins the merge', () => {
    // Locker copy (no collectionId, no rating) beats the iTunes copy in the merge.
    const lockerDamn = mkAlbum({
      id: 'local-damn',
      title: 'DAMN.',
      artist: 'Kendrick Lamar',
      trackCount: 14,
    });
    const itunesDamn = mkAlbum({
      id: 'album-damn',
      title: 'DAMN.',
      artist: 'Kendrick Lamar',
      collectionId: 1440881047,
      trackCount: 14,
      explicit: true,
      contentRating: 'explicit',
    });

    const editions = listCatalogAlbumEditions([lockerDamn, itunesDamn]);
    const survivor = editions.find((a) => /damn/i.test(a.title));
    expect(survivor).toBeDefined();
    expect(survivor!.explicit).toBe(true);
    expect(survivor!.contentRating).toBe('explicit');
  });

  it('back-fills a catalog cover when the winning locker edition has none', () => {
    const lockerNoArt = mkAlbum({
      id: 'local-hndrxx',
      title: 'HNDRXX',
      artist: 'Future',
      trackCount: 17,
    });
    const itunesWithArt = mkAlbum({
      id: 'album-hndrxx',
      title: 'HNDRXX',
      artist: 'Future',
      collectionId: 1200756744,
      trackCount: 17,
      artworkUrl: 'https://is1.mzstatic.com/hndrxx/600x600bb.jpg',
    });

    const editions = listCatalogAlbumEditions([lockerNoArt, itunesWithArt]);
    const survivor = editions.find((a) => /hndrxx/i.test(a.title));
    expect(survivor?.artworkUrl).toBe('https://is1.mzstatic.com/hndrxx/600x600bb.jpg');
  });

  it('does not replace a transient blob cover check but keeps https over blob', () => {
    const lockerBlob = mkAlbum({
      id: 'local-blobart',
      title: 'Blob Art',
      artist: 'Future',
      trackCount: 12,
      artworkUrl: 'blob:https://localhost/abc-123',
    });
    const itunesHttps = mkAlbum({
      id: 'album-blobart',
      title: 'Blob Art',
      artist: 'Future',
      collectionId: 999,
      trackCount: 12,
      artworkUrl: 'https://is1.mzstatic.com/blobart/600x600bb.jpg',
    });
    const editions = listCatalogAlbumEditions([lockerBlob, itunesHttps]);
    for (const album of editions) {
      expect(album.artworkUrl).toBe('https://is1.mzstatic.com/blobart/600x600bb.jpg');
    }
  });

  it('back-fills clean rating and never overrides an existing rating', () => {
    const lockerClean = mkAlbum({
      id: 'local-clean',
      title: 'Clean Only',
      artist: 'Some Artist',
      trackCount: 10,
    });
    const itunesClean = mkAlbum({
      id: 'album-clean-only',
      title: 'Clean Only',
      artist: 'Some Artist',
      collectionId: 555,
      trackCount: 10,
      contentRating: 'clean',
    });

    const editions = listCatalogAlbumEditions([lockerClean, itunesClean]);
    // The iTunes edition keeps its own rating; the ratingless locker copy inherits clean.
    for (const album of editions) {
      expect(album.contentRating).toBe('clean');
      expect(album.explicit).toBeFalsy();
    }
  });
});
