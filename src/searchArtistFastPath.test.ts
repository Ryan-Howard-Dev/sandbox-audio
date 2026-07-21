import {
  describe, expect, it,
} from 'vitest';
import {
  buildCatalogArtistStub,
  findCatalogArtistByName,
  isLikelyArtistNameQuery,
} from './searchCatalog';
import type { CatalogArtist } from './searchCatalog';

describe('search artist fast path', () => {
  it('treats Kanye West as an artist-name query', () => {
    expect(isLikelyArtistNameQuery('Kanye West')).toBe(true);
    expect(isLikelyArtistNameQuery('Tyler The Creator')).toBe(true);
    expect(isLikelyArtistNameQuery('See You Again')).toBe(false);
    expect(isLikelyArtistNameQuery('Kanye West Power feat Jay-Z')).toBe(false);
  });

  it('rejects artist-plus-track phrases as artist-only queries', () => {
    expect(isLikelyArtistNameQuery('Drake Gods Plan')).toBe(false);
    expect(isLikelyArtistNameQuery('Jay-Z Holy Grail')).toBe(false);
    expect(isLikelyArtistNameQuery('Future Zone')).toBe(false);
  });

  it('still allows three-word artist names with the/and', () => {
    expect(isLikelyArtistNameQuery('Florence and the Machine')).toBe(false);
    expect(isLikelyArtistNameQuery('Simon and Garfunkel')).toBe(true);
  });
  it('finds exact artist matches across lists', () => {
    const kanye: CatalogArtist = { kind: 'artist', id: 'artist-1', name: 'Kanye West' };
    expect(findCatalogArtistByName('kanye west', [kanye])).toEqual(kanye);
  });

  it('builds a navigable artist stub', () => {
    expect(buildCatalogArtistStub('Kanye West')).toMatchObject({
      kind: 'artist',
      name: 'Kanye West',
      id: 'artist-kanye-west',
    });
  });
});
