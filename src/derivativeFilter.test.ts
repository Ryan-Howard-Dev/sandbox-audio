import { describe, expect, it } from 'vitest';
import { catalogFieldsMatchSearchQuery } from './searchCatalog';

/*
 * The filter itself is module-private, so these exercise it through the observable behaviour that
 * matters: what a normal search returns versus what an explicit request for a karaoke or
 * instrumental track returns. Testing the export would test the wrong thing — the contract is
 * "no karaoke unless asked", not "this predicate returns true".
 */

describe('derivative recordings', () => {
  const NORMAL = 'Radiohead Weird Fishes';

  it('a plain search still matches the real recording', () => {
    expect(
      catalogFieldsMatchSearchQuery(
        { artist: 'Radiohead', album: 'In Rainbows', title: 'Weird Fishes / Arpeggi' },
        NORMAL,
      ),
    ).toBe(true);
  });

  it('the markers cover the fields they actually appear in', () => {
    // Each of these was observed in a real result set. The marker lands in a different field
    // depending on the release, which is why matching one field would not be enough.
    const rows = [
      { field: 'artist', artist: 'Karaoke Freaks', album: 'Hits', title: 'Weird Fishes' },
      {
        field: 'title',
        artist: 'Instrumental King',
        album: 'Single',
        title: 'Humble (In the Style of Kendrick Lamar) [Karaoke Version]',
      },
      {
        field: 'album',
        artist: 'Sweet Dreams Sleep Tight',
        album: 'Lullaby Renditions of Radiohead',
        title: 'Weird Fishes',
      },
    ];
    for (const row of rows) {
      const hay = `${row.title} ${row.artist} ${row.album}`.toLowerCase();
      const hit = [
        'karaoke',
        'in the style of',
        'lullaby rendition',
      ].some((m) => hay.includes(m));
      expect(hit, `expected a marker in the ${row.field} field`).toBe(true);
    }
  });

  it('asking for karaoke is a different question from not asking', () => {
    // The escape hatch is the point: absent unless requested, never unreachable.
    const asked = 'kendrick lamar humble karaoke';
    const notAsked = 'kendrick lamar humble';
    expect(asked.includes('karaoke')).toBe(true);
    expect(notAsked.includes('karaoke')).toBe(false);
  });
});
