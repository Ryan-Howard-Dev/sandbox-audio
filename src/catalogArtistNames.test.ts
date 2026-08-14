/**
 * An artist's name is not a credit line, and some names contain a comma.
 *
 * Reported from the phone: searching "Tyler the creator" opened an impersonator called "Tyler
 * Durden The Creator", with three thirty-second previews and no albums at all.
 *
 * The catalog was not at fault. Its top artist result for that query is the right one. What the
 * app had done was store every artist entity through the credit-line splitter, which cuts at the
 * first comma, so "Tyler, The Creator" was filed as "Tyler". Read back off the device, the
 * candidate list was:
 *
 *   artist-6793035176  Tyler Durden The Creator
 *   artist-1788862784  NotTylerTheCreator
 *   artist-420368335   Tyler                     <- the real one
 *   artist-1804881250  Not Tyler
 *
 * Ranked against "tyler the creator", "Tyler" matches one word of three and scores 100, while
 * "Tyler Durden The Creator" matches all three and scores 700. The ranking was working correctly
 * on the only names it had been given.
 */

import { describe, expect, it } from 'vitest';
import {
  catalogDisplayArtistName,
  catalogEntityArtistName,
  catalogPrimaryArtistName,
} from './searchCatalog';

describe('catalogEntityArtistName', () => {
  it('keeps a comma that belongs to the name', () => {
    expect(catalogEntityArtistName('Tyler, The Creator')).toBe('Tyler, The Creator');
  });

  it('keeps the bands that would lose most of their name', () => {
    // Same shape, same failure: the splitter would file these as Earth, Emerson and Crosby.
    expect(catalogEntityArtistName('Earth, Wind & Fire')).toBe('Earth, Wind & Fire');
    expect(catalogEntityArtistName('Emerson, Lake & Palmer')).toBe('Emerson, Lake & Palmer');
    expect(catalogEntityArtistName('Crosby, Stills & Nash')).toBe('Crosby, Stills & Nash');
  });

  it('keeps an impersonator intact too, so ranking can tell them apart', () => {
    expect(catalogEntityArtistName('Tyler Durden The Creator')).toBe('Tyler Durden The Creator');
    expect(catalogEntityArtistName('Not Tyler, The Creator')).toBe('Not Tyler, The Creator');
  });

  it('still canonicalises billing duplicates', () => {
    // Alias folding fixes a duplicate entity rather than cutting a name, so it stays.
    expect(catalogEntityArtistName('Kanye Omari West')).toBe('Kanye West');
  });

  it('is unbothered by empty input', () => {
    expect(catalogEntityArtistName('   ')).toBe('');
  });
});

describe('catalogPrimaryArtistName still reduces a credit line', () => {
  it('takes whoever a track is mostly by', () => {
    // The behaviour the splitter exists for, and which a locker tag still needs.
    expect(catalogPrimaryArtistName('Armani White & Denzel Curry')).toBe('Armani White');
    expect(catalogPrimaryArtistName('Kali Uchis feat. Bootsy Collins')).toBe('Kali Uchis');
    expect(catalogPrimaryArtistName('Drake, Future')).toBe('Drake');
  });

  it('is exactly what must not be used on an entity', () => {
    // Kept as the record of why the two functions are separate.
    expect(catalogPrimaryArtistName('Tyler, The Creator')).toBe('Tyler');
    expect(catalogDisplayArtistName('Tyler, The Creator')).toBe('Tyler');
  });
});

describe('the ranking that sent the search wrong', () => {
  /** The scorer, mirrored from searchCatalog so the inversion can be asserted directly. */
  const normalize = (v: string) =>
    v.toLowerCase().replace(/[¥$,]/g, ' ').trim().replace(/\s+/g, ' ');

  const score = (name: string, query: string): number => {
    const n = normalize(name);
    const q = normalize(query);
    if (n === q) return 1000;
    if (n.startsWith(q)) return 900;
    const words = q.split(' ').filter(Boolean);
    if (words.length > 1 && words.every((w) => n.includes(w))) {
      return n.startsWith(words[0]!) ? 700 : 500;
    }
    if (n.includes(q)) return 300;
    if (words.some((w) => n.includes(w))) return 100;
    return 0;
  };

  const query = 'tyler the creator';

  it('put the impersonator ahead while the name was truncated', () => {
    expect(score('Tyler', query)).toBe(100);
    expect(score('Tyler Durden The Creator', query)).toBe(700);
  });

  it('puts the real artist first once the name is kept whole', () => {
    // The comma normalises away, so the full name is an exact match and wins outright.
    expect(score(catalogEntityArtistName('Tyler, The Creator'), query)).toBe(1000);
    expect(score(catalogEntityArtistName('Tyler, The Creator'), query)).toBeGreaterThan(
      score('Tyler Durden The Creator', query),
    );
  });
});

describe('merging the same artist billed several ways', () => {
  /** preferCatalogArtistRecord, mirrored: shorter entity name wins, artwork carried across. */
  const merge = (a: string, b: string) => {
    const an = catalogEntityArtistName(a);
    const bn = catalogEntityArtistName(b);
    return an.length <= bn.length ? an : bn;
  };

  it('keeps the plain name over a collaboration billing', () => {
    // Both are the same artistId. The plain one is the artist; the longer is that release.
    expect(merge('Tyler, The Creator', 'Tyler, The Creator & Nigo')).toBe('Tyler, The Creator');
  });

  it('does not cut the name while merging', () => {
    /*
     * The bug that survived the first fix. Reducing both sides through the credit-line splitter
     * merged them to "Tyler", undoing at the merge what the upsert had just preserved. His id
     * appears thirty-seven times in one search response, so this ran on nearly all of them.
     */
    expect(catalogDisplayArtistName('Tyler, The Creator')).toBe('Tyler');
    expect(merge('Tyler, The Creator', 'Tyler, The Creator & Nigo')).not.toBe('Tyler');
  });
});
