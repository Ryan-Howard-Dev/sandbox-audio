import { describe, expect, it } from 'vitest';
import type { CatalogProviderItem } from './catalogFetch';
import { scoreCatalogAlbumIdentification } from './searchCatalog';

const anneWilsonRebel: CatalogProviderItem = {
  collectionId: 1,
  collectionName: 'REBEL',
  artistName: 'Anne Wilson',
  trackCount: 12,
  wrapperType: 'collection',
};

const esdeekidRebel: CatalogProviderItem = {
  collectionId: 2,
  collectionName: 'Rebel',
  artistName: 'EsDeeKid',
  trackCount: 10,
  wrapperType: 'collection',
};

describe('scoreCatalogAlbumIdentification', () => {
  it('rejects title-only iTunes matches without an artist hint', () => {
    expect(scoreCatalogAlbumIdentification(anneWilsonRebel, 'Rebel')).toBeNull();
    expect(scoreCatalogAlbumIdentification(esdeekidRebel, 'Rebel')).toBeNull();
  });

  it('accepts iTunes rows when artist hint matches', () => {
    const match = scoreCatalogAlbumIdentification(esdeekidRebel, 'Rebel', 'EsDeeKid');
    expect(match).not.toBeNull();
    expect(match!.matchKind).toBe('official');
  });

  it('rejects Anne Wilson REBEL when artist hint is EsDeeKid', () => {
    expect(scoreCatalogAlbumIdentification(anneWilsonRebel, 'Rebel', 'EsDeeKid')).toBeNull();
  });
});
