import { describe, expect, it } from 'vitest';
import {
  buildCatalogSearchTerms,
  catalogFieldsMatchSearchQuery,
  expandFuzzyQueryCorrections,
  fuzzyTokensEquivalent,
  isLikelyArtistNameQuery,
  isLikelyCombinedTrackQuery,
  isLikelyTrackTitleQuery,
  needsWebTrackSupplement,
  parseArtistAlbumQuery,
  parseCombinedTrackQuery,
  parseCoverTrackQuery,
} from './searchCatalog';

describe('parseCombinedTrackQuery', () => {
  it('splits title + trailing artist tokens', () => {
    expect(parseCombinedTrackQuery('Take off your dress Kanye')).toEqual({
      title: 'take off your dress',
      artist: 'kanye',
    });
    expect(parseCombinedTrackQuery('take off your dress')).toBeNull();
  });

  it('splits leading artist + title tokens', () => {
    expect(parseCombinedTrackQuery('Kanye take off your dress')).toEqual({
      title: 'take off your dress',
      artist: 'kanye',
    });
    expect(parseCombinedTrackQuery('Drake Gods Plan')).toEqual({
      title: 'gods plan',
      artist: 'drake',
    });
  });

  it('does not steal two-word album intents', () => {
    expect(parseCombinedTrackQuery('Future Zone')).toBeNull();
    expect(parseCombinedTrackQuery('Kanye West')).toBeNull();
  });

  it('parses kanye + backstreet as performer + reference title', () => {
    expect(parseCombinedTrackQuery('kanye backstreet')).toEqual({
      title: 'backstreet',
      artist: 'kanye',
    });
    expect(parseCombinedTrackQuery('i want it that way kanye')).toEqual({
      title: 'want it that way',
      artist: 'kanye',
    });
  });
});

describe('parseCoverTrackQuery', () => {
  it('detects Kanye Backstreet Boys cover intent', () => {
    expect(parseCoverTrackQuery('kanye backstreet')).toMatchObject({
      performer: 'kanye',
      referenceArtist: 'Backstreet Boys',
      titleHint: 'I Want It That Way',
    });
    expect(parseCoverTrackQuery('backstreet boys kanye cover')).toMatchObject({
      performer: 'kanye',
      referenceArtist: 'Backstreet Boys',
    });
    expect(parseCoverTrackQuery('the back street song kanye covered')).toMatchObject({
      performer: 'kanye',
      referenceArtist: 'Backstreet Boys',
    });
  });
});

describe('parseArtistAlbumQuery', () => {
  it('splits artist + album tokens', () => {
    expect(parseArtistAlbumQuery('Future Zone')).toEqual({
      artist: 'future',
      album: 'zone',
    });
    expect(parseArtistAlbumQuery('Drake Gods Plan')).toEqual({
      artist: 'drake',
      album: 'gods plan',
    });
  });

  it('does not split multi-word artist names', () => {
    expect(parseArtistAlbumQuery('Kanye West')).toBeNull();
    expect(parseArtistAlbumQuery('Tyler The Creator')).toBeNull();
    expect(parseArtistAlbumQuery('Simon and Garfunkel')).toBeNull();
  });

  it('defers long title+artist queries to combined track parsing', () => {
    expect(parseArtistAlbumQuery('Take off your dress Kanye')).toBeNull();
  });
});

describe('buildCatalogSearchTerms', () => {
  it('expands title+artist queries for iTunes search', () => {
    const terms = buildCatalogSearchTerms('Take off your dress Kanye');
    expect(terms).toContain('Take off your dress Kanye');
    expect(terms).toContain('kanye take off your dress');
    expect(terms).toContain('Kanye West take off your dress');
  });

  it('expands fuzzy typos and cover queries', () => {
    const melros = buildCatalogSearchTerms('melros');
    expect(melros.some((t) => /melrose/i.test(t))).toBe(true);

    const cover = buildCatalogSearchTerms('kanye backstreet');
    expect(cover.some((t) => /want it that way/i.test(t))).toBe(true);
  });
});

describe('fuzzy matching', () => {
  it('matches melros to melrose', () => {
    expect(fuzzyTokensEquivalent('melros', 'melrose')).toBe(true);
    expect(expandFuzzyQueryCorrections('melros')).toContain('melrose');
  });

  it('never maps dress to drip or other unrelated words', () => {
    expect(fuzzyTokensEquivalent('dress', 'drip')).toBe(false);
    expect(fuzzyTokensEquivalent('drip', 'dress')).toBe(false);
    expect(fuzzyTokensEquivalent('dress', 'drop')).toBe(false);
    const dressTerms = buildCatalogSearchTerms('take off your dress kanye');
    expect(dressTerms.every((t) => !/\bdrip\b/i.test(t))).toBe(true);
    const corrections = expandFuzzyQueryCorrections('take off your dress');
    expect(corrections.every((t) => !/\bdrip\b/i.test(t))).toBe(true);
  });

  it('keeps drip queries intact without dress substitution', () => {
    const dripTerms = buildCatalogSearchTerms('take off your drip kanye');
    expect(dripTerms[0]).toBe('take off your drip kanye');
    expect(dripTerms.some((t) => /\bdrip\b/i.test(t))).toBe(true);
    expect(dripTerms.every((t) => !/\bdress\b/i.test(t))).toBe(true);
  });
});

describe('isLikelyCombinedTrackQuery', () => {
  it('flags title+artist searches', () => {
    expect(isLikelyCombinedTrackQuery('Take off your dress Kanye')).toBe(true);
    expect(isLikelyCombinedTrackQuery('Future Zone')).toBe(false);
  });
});

describe('isLikelyTrackTitleQuery', () => {
  it('treats song titles and cover queries as track-first', () => {
    expect(isLikelyTrackTitleQuery('melrose')).toBe(true);
    expect(isLikelyTrackTitleQuery('melros')).toBe(true);
    expect(isLikelyTrackTitleQuery('take off your dress')).toBe(true);
    expect(isLikelyTrackTitleQuery('kanye backstreet')).toBe(true);
    expect(isLikelyTrackTitleQuery('backstreet boys kanye cover')).toBe(true);
    expect(isLikelyTrackTitleQuery('i want it that way kanye')).toBe(true);
    expect(isLikelyTrackTitleQuery('the back street song kanye covered')).toBe(true);
  });

  it('does not flag plain artist names', () => {
    expect(isLikelyTrackTitleQuery('Kanye West')).toBe(false);
    expect(isLikelyTrackTitleQuery('Tyler The Creator')).toBe(false);
    expect(isLikelyTrackTitleQuery('EsDeeKid')).toBe(false);
    expect(isLikelyTrackTitleQuery('Esdeekid')).toBe(false);
    expect(isLikelyTrackTitleQuery('Esdee Kid')).toBe(false);
  });
});

describe('needsWebTrackSupplement', () => {
  it('forces YouTube fallback for covers and leaks', () => {
    expect(needsWebTrackSupplement('kanye backstreet')).toBe(true);
    expect(needsWebTrackSupplement('backstreet boys kanye cover')).toBe(true);
    expect(needsWebTrackSupplement('Take off your dress Kanye')).toBe(true);
    expect(needsWebTrackSupplement('Kanye take off your dress')).toBe(true);
    expect(needsWebTrackSupplement('Kanye West')).toBe(false);
  });
});

describe('isLikelyArtistNameQuery', () => {
  it('treats Kanye West as an artist-name query', () => {
    expect(isLikelyArtistNameQuery('Kanye West')).toBe(true);
    expect(isLikelyArtistNameQuery('Tyler The Creator')).toBe(true);
    expect(isLikelyArtistNameQuery('EsDeeKid')).toBe(true);
    expect(isLikelyArtistNameQuery('Esdeekid')).toBe(true);
    expect(isLikelyArtistNameQuery('Esdee Kid')).toBe(true);
  });

  it('rejects artist-plus-album phrases', () => {
    expect(isLikelyArtistNameQuery('Future Zone')).toBe(false);
    expect(isLikelyArtistNameQuery('Drake Gods Plan')).toBe(false);
    expect(isLikelyArtistNameQuery('Jay-Z Holy Grail')).toBe(false);
  });

  it('rejects track-title and cover queries', () => {
    expect(isLikelyArtistNameQuery('melrose')).toBe(false);
    expect(isLikelyArtistNameQuery('take off your dress')).toBe(false);
    expect(isLikelyArtistNameQuery('kanye backstreet')).toBe(false);
  });
});

describe('catalogFieldsMatchSearchQuery', () => {
  it('requires artist and album token overlap for split queries', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Future', album: 'FUTURE', title: 'Draco' },
        'Future Zone',
      ),
    ).toBe(false);

    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Danny Daze', album: 'Future Classic DJs Compilation', title: 'Zone' },
        'Future Zone',
      ),
    ).toBe(false);

    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Justin Timberlake', album: 'FutureSex/LoveSounds', title: 'SexyBack' },
        'Future Zone',
      ),
    ).toBe(false);
  });

  it('accepts rows that match both artist and album tokens', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Future', album: 'ZONE', title: 'Mask Off' },
        'Future Zone',
      ),
    ).toBe(true);
  });

  it('matches title+artist combined queries', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        {
          artist: 'Kanye West',
          album: 'VULTURES',
          title: 'Take Off Your Dress',
        },
        'Take off your dress Kanye',
      ),
    ).toBe(true);

    expect(
      catalogFieldsMatchSearchQuery(
        {
          artist: 'Ye',
          album: 'Vultures',
          title: 'Melrose',
        },
        'Melrose Kanye',
      ),
    ).toBe(true);
  });

  it('matches fuzzy track titles and cover performer rows', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Ye', album: 'VULTURES', title: 'Melrose' },
        'melros',
      ),
    ).toBe(true);

    expect(
      catalogFieldsMatchSearchQuery(
        {
          artist: 'Kanye West',
          album: 'Karaoke',
          title: 'I Want It That Way',
        },
        'kanye backstreet',
      ),
    ).toBe(true);
  });
});

/*
 * Search returned nothing on a device with working network, and every layer reported it as a
 * normal empty result. iTunes was returning 70 correct rows for "kendrick lamar humble" and the
 * matcher discarded all of them: parseCombinedTrackQuery guessed the artist was "humble", and that
 * guess was allowed to veto rows. These pin the rule that came out of it — a speculative split may
 * accept a row, never reject one — while keeping the two-word veto that stops real false positives.
 */
describe('catalogFieldsMatchSearchQuery — a bad split must not empty the results', () => {
  it('matches the row the user asked for when the split guesses wrong', () => {
    // Parses as artist "humble", which is backwards; the row must still match.
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Kendrick Lamar', album: 'DAMN.', title: 'HUMBLE.' },
        'kendrick lamar humble',
      ),
    ).toBe(true);
  });

  it('matches a collaboration where both artists are typed', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Kid Cudi & Denzel Curry', album: 'BLACK OPS - Single', title: 'Black Ops' },
        'denzel curry kid cudi black ops',
      ),
    ).toBe(true);
  });

  it('matches whichever way round the artist and title are typed', () => {
    const row = { artist: 'Denzel Curry', album: 'Melt My Eyez See Your Future', title: 'Walkin' };
    expect(catalogFieldsMatchSearchQuery(row, 'denzel curry walkin')).toBe(true);
    expect(catalogFieldsMatchSearchQuery(row, 'walkin denzel curry')).toBe(true);
  });

  /* The veto still earns its keep where the split is unambiguous. */
  it('still rejects a compilation that merely contains both words', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Danny Daze', album: 'Future Classic DJs Compilation', title: 'Zone' },
        'Future Zone',
      ),
    ).toBe(false);
  });

  it('still rejects a row missing one of the typed words', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Kendrick Lamar', album: 'DAMN.', title: 'DNA.' },
        'kendrick lamar humble',
      ),
    ).toBe(false);
  });
});
