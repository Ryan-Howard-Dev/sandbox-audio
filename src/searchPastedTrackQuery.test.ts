/**
 * Pasting a track's full name and finding nothing.
 *
 * Reported from the phone: searching
 *
 *   DENZEL CURRY - 13LOOD 1N + 13LOOD OUT MIXX (FT. GHOSTEMANE, ZILLAKAMI, XAVIER WULF, & AK)
 *
 * returned no way to play it. That string is how the track is written everywhere it exists, and
 * pasting it is the obvious thing to do. It is not in the iTunes catalog at all -- checked against
 * the live API, zero results for the title under any spelling -- so the only path to it is the web
 * supplement, and three separate things stopped that working.
 */

import { describe, expect, it } from 'vitest';
import {
  needsWebTrackSupplement,
  parseCombinedTrackQuery,
  webCatalogTrackMatchesQuery,
} from './searchCatalog';

const PASTED =
  'DENZEL CURRY - 13LOOD 1N + 13LOOD OUT MIXX (FT. GHOSTEMANE, ZILLAKAMI, XAVIER WULF, & AK)';

describe('a track name pasted whole', () => {
  it('splits at the separator the writer put there', () => {
    // It used to guess by scoring token runs, and with commas in the feature list the guess landed
    // on artist "ak)" and a title made of everything else. A spaced dash is not a guess.
    const combined = parseCombinedTrackQuery(PASTED);
    expect(combined?.artist).toBe('denzel curry');
    expect(combined?.title.startsWith('13lood 1n')).toBe(true);
  });

  it('still splits an en dash or em dash', () => {
    expect(parseCombinedTrackQuery('Burial – Archangel')?.artist).toBe('burial');
    expect(parseCombinedTrackQuery('Aphex Twin — Xtal')?.artist).toBe('aphex twin');
  });

  it('leaves a hyphenated name alone', () => {
    // No spaces around the hyphen, so it is part of a word rather than a separator.
    expect(parseCombinedTrackQuery('Jay-Z')).toBeNull();
  });

  it('asks the web, because iTunes does not carry mixtapes', () => {
    // The gate was a list of hardcoded tokens from an earlier bug, so it fired for one artist's
    // catalogue and nobody else's.
    expect(needsWebTrackSupplement(PASTED)).toBe(true);
  });

  it('asks the web for any artist, not a hardcoded few', () => {
    expect(needsWebTrackSupplement('Playboi Carti - Cancun')).toBe(true);
    expect(needsWebTrackSupplement('MF DOOM - Doomsday (Original Mix)')).toBe(true);
  });

  it('does not drag the web in for a plain artist browse', () => {
    expect(needsWebTrackSupplement('Radiohead')).toBe(false);
    expect(needsWebTrackSupplement('Denzel Curry')).toBe(false);
  });
});

describe('matching a web row against a pasted name', () => {
  const row = (title: string) => ({ id: 'youtube-abc12345678', title, artist: 'YouTube' });

  it('accepts the video even when it omits the guest list', () => {
    // A pasted name carries every guest; the upload usually does not. Demanding all but one token
    // meant the longer the name somebody pasted, the less could match it.
    expect(webCatalogTrackMatchesQuery(row('DENZEL CURRY - 13LOOD 1N + 13LOOD OUT MIXX'), PASTED)).toBe(true);
  });

  it('accepts the video that spells the guest list out in full', () => {
    expect(
      webCatalogTrackMatchesQuery(
        row('Denzel Curry - 13LOOD 1N + 13LOOD OUT MIXX (Ft. GHOSTEMANE, ZillaKami, Xavier Wulf, & AK)'),
        PASTED,
      ),
    ).toBe(true);
  });

  it('still turns away a video that is a different track', () => {
    expect(webCatalogTrackMatchesQuery(row('Denzel Curry - ULT (Official Video)'), PASTED)).toBe(false);
    expect(webCatalogTrackMatchesQuery(row('Top 50 Rap Songs of 2018'), PASTED)).toBe(false);
  });
});
