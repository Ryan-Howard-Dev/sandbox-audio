import { describe, expect, it } from 'vitest';
import { isArtistTitleMashupName, isUsableArtistName } from './lockerStorage';

/**
 * Regression guard for duplicate joint albums.
 *
 * "Future & Metro Boomin" was classified as an artist-plus-title mashup (known prefix
 * "Future" + short words "metro boomin"), which made isUsableArtistName() false for the
 * album-artist tag. Album grouping then fell back to a per-track heuristic, and the tracks
 * carrying featured artists landed in a second "Local Upload" bucket — so "We Don't Trust
 * You" rendered twice (12 tracks + 4) on the artist page.
 */
describe('collaboration billings are usable artist names', () => {
  const collabs = [
    'Future & Metro Boomin',
    'Metro Boomin, Future',
    'JPEGMAFIA & Danny Brown',
    'Drake & Future',
    'Kanye West & Ty Dolla $ign',
    'Tyler, The Creator',
    'Modeselektor x Thom Yorke',
    'Calvin Harris feat. Dua Lipa',
    'Nas ft. Damian Marley',
    'Kendrick Lamar with SZA',
  ];

  for (const name of collabs) {
    it(`treats "${name}" as a real artist billing`, () => {
      expect(isArtistTitleMashupName(name)).toBe(false);
      expect(isUsableArtistName(name)).toBe(true);
    });
  }
});

describe('genuine artist+title mashups are still rejected', () => {
  it('still flags a known-prefix name followed by title words (no collab separator)', () => {
    // The mashup heuristic must keep working when there is no billing separator at all.
    expect(isArtistTitleMashupName('Future Pluto Presents')).toBe(true);
  });

  it('rejects empty and placeholder names', () => {
    expect(isUsableArtistName('')).toBe(false);
    expect(isUsableArtistName('Local Upload')).toBe(false);
  });
});
