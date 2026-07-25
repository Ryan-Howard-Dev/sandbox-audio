import { describe, expect, it } from 'vitest';
import {
  catalogAlbumIdentityKey,
  listCatalogAlbumEditions,
  normalizeCatalogArtistKey,
  type CatalogAlbum,
} from './searchCatalog';

function album(over: Partial<CatalogAlbum>): CatalogAlbum {
  return {
    kind: 'album',
    id: Math.random().toString(36).slice(2),
    title: 'WE DONT TRUST YOU',
    artist: 'Future & Metro Boomin',
    releaseYear: '2024',
    ...over,
  };
}

describe('normalizeCatalogArtistKey', () => {
  it('is order-independent for collaborations', () => {
    expect(normalizeCatalogArtistKey('Future & Metro Boomin')).toBe(
      normalizeCatalogArtistKey('Metro Boomin, Future'),
    );
  });

  it('leaves a single artist untouched', () => {
    expect(normalizeCatalogArtistKey('Future')).toBe('future');
  });
});

describe('catalogAlbumIdentityKey', () => {
  it('treats a collaboration and its lead-artist billing as the same album', () => {
    // iTunes returns the same release under both billings; they must be siblings or the
    // partial-duplicate collapse never compares them.
    expect(catalogAlbumIdentityKey('Future & Metro Boomin', 'WE DONT TRUST YOU')).toBe(
      catalogAlbumIdentityKey('Future', 'WE DONT TRUST YOU'),
    );
  });

  it('still separates different albums by the same artist', () => {
    expect(catalogAlbumIdentityKey('Future', 'The Real Me')).not.toBe(
      catalogAlbumIdentityKey('Future', 'WE DONT TRUST YOU'),
    );
  });

  it('still separates same-titled albums by unrelated artists', () => {
    expect(catalogAlbumIdentityKey('Future', 'Wildflower')).not.toBe(
      catalogAlbumIdentityKey('Billy Talent', 'Wildflower'),
    );
  });
});

describe('joint-album duplicate collapse', () => {
  it('drops the partial entry when a fuller sibling is billed differently', () => {
    // The exact shape seen on Future's artist page: 12-track and 4-track entries for one
    // album, billed inconsistently, both showing as separate albums.
    const full = album({ id: 'full', artist: 'Future & Metro Boomin', trackCount: 12, collectionId: 1 });
    const partial = album({ id: 'partial', artist: 'Future', trackCount: 4, collectionId: 2 });

    const editions = listCatalogAlbumEditions([full, partial]);
    expect(editions).toHaveLength(1);
    expect(editions[0].trackCount).toBe(12);
  });

  it('keeps both when track counts are comparable (real editions, not partials)', () => {
    const standard = album({ id: 'std', trackCount: 16, collectionId: 10 });
    const deluxe = album({
      id: 'dlx',
      title: 'WE DONT TRUST YOU (Deluxe)',
      trackCount: 24,
      collectionId: 11,
    });
    const editions = listCatalogAlbumEditions([standard, deluxe]);
    expect(editions.length).toBeGreaterThan(1);
  });
});
