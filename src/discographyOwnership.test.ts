import { describe, expect, it } from 'vitest';
import {
  downloadCandidates,
  isSameRelease,
  normaliseReleaseTitle,
  resolveDiscography,
  summariseDiscography,
  type CatalogueRelease,
  type HeldRelease,
} from './discographyOwnership';

const DISCOGRAPHY: CatalogueRelease[] = [
  { id: '1', title: 'The Dark Side of the Moon', year: 1973, trackCount: 10, kind: 'album' },
  { id: '2', title: 'Wish You Were Here', year: 1975, trackCount: 5, kind: 'album' },
  { id: '3', title: 'Animals', year: 1977, trackCount: 5, kind: 'album' },
  { id: '4', title: 'Echoes', year: 2001, trackCount: 26, kind: 'compilation' },
];

describe('matching a catalogue title to a file on disk', () => {
  it('sees through a remaster suffix', () => {
    /*
     * The failure this prevents is the one that matters most: telling somebody they are missing
     * an album they have been listening to for years, because their rip says "[2011 Remaster]".
     */
    expect(isSameRelease('The Dark Side of the Moon', 'Dark Side Of The Moon [2011 Remaster]')).toBe(
      true,
    );
  });

  it('sees through editions, brackets, case and articles', () => {
    expect(isSameRelease('Animals', 'ANIMALS (Deluxe Edition)')).toBe(true);
    expect(isSameRelease('The Wall', 'Wall')).toBe(true);
    expect(isSameRelease("Sgt. Pepper's", 'Sgt Peppers')).toBe(true);
  });

  it('does not collapse records that are genuinely different', () => {
    // A live album is not the studio album, and saying it is reports an album owned that is not.
    expect(isSameRelease('Live at Leeds', 'Leeds')).toBe(false);
    expect(isSameRelease('Animals', 'Amused to Death')).toBe(false);
  });

  it('never matches on nothing', () => {
    expect(isSameRelease('', '')).toBe(false);
    expect(isSameRelease('(Remastered)', 'Animals')).toBe(false);
  });

  it('normalises to something a human can check', () => {
    expect(normaliseReleaseTitle('The Dark Side of the Moon [2011 Remaster]')).toBe(
      'dark side of the moon',
    );
  });
});

describe('resolveDiscography', () => {
  it('marks a complete album owned', () => {
    const held: HeldRelease[] = [{ key: 'a', title: 'Animals', trackCount: 5 }];
    const entry = resolveDiscography(DISCOGRAPHY, held).find((e) => e.release.id === '3')!;
    expect(entry.state).toBe('owned');
    expect(entry.heldKey).toBe('a');
  });

  it('marks a half-held album partial, with the count', () => {
    const held: HeldRelease[] = [{ key: 'b', title: 'Wish You Were Here', trackCount: 3 }];
    const entry = resolveDiscography(DISCOGRAPHY, held).find((e) => e.release.id === '2')!;
    expect(entry.state).toBe('partial');
    expect(entry.heldTracks).toBe(3);
    expect(entry.catalogueTracks).toBe(5);
  });

  it('marks what is not there missing', () => {
    const entry = resolveDiscography(DISCOGRAPHY, []).find((e) => e.release.id === '1')!;
    expect(entry.state).toBe('missing');
    expect(entry.heldTracks).toBe(0);
    expect(entry.heldKey).toBeNull();
  });

  it('counts holding more tracks than the catalogue lists as owned', () => {
    // Bonus discs and hidden tracks are normal. Reporting "11 of 10" as partial is nonsense.
    const held: HeldRelease[] = [
      { key: 'c', title: 'The Dark Side of the Moon', trackCount: 11 },
    ];
    const entry = resolveDiscography(DISCOGRAPHY, held).find((e) => e.release.id === '1')!;
    expect(entry.state).toBe('owned');
  });

  it('calls it owned when the catalogue never said how many tracks there are', () => {
    /*
     * Common outside well-curated data. "You have 9 of unknown" is not worth showing anyone, so
     * holding any of it counts rather than sitting permanently at partial.
     */
    const sparse: CatalogueRelease[] = [{ id: 'x', title: 'Obscured by Clouds' }];
    const held: HeldRelease[] = [{ key: 'd', title: 'Obscured by Clouds', trackCount: 4 }];
    expect(resolveDiscography(sparse, held)[0]!.state).toBe('owned');
  });

  it('treats an album matched but empty as missing', () => {
    const held: HeldRelease[] = [{ key: 'e', title: 'Animals', trackCount: 0 }];
    expect(resolveDiscography(DISCOGRAPHY, held)[2]!.state).toBe('missing');
  });

  it('keeps the catalogue order it was given', () => {
    const entries = resolveDiscography(DISCOGRAPHY, []);
    expect(entries.map((e) => e.release.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('summariseDiscography', () => {
  const held: HeldRelease[] = [
    { key: 'a', title: 'Animals', trackCount: 5 },
    { key: 'b', title: 'Wish You Were Here', trackCount: 3 },
  ];

  it('counts each state', () => {
    const summary = summariseDiscography(resolveDiscography(DISCOGRAPHY, held));
    expect(summary).toMatchObject({ owned: 1, partial: 1, missing: 2, total: 4 });
  });

  it('counts completion in records, not tracks', () => {
    /*
     * Somebody with every album but one 26-track compilation has a complete collection in the
     * sense they care about. Counting tracks would tell them they are at 44%.
     */
    const summary = summariseDiscography(resolveDiscography(DISCOGRAPHY, held));
    expect(summary.completion).toBeCloseTo((1 + 0.5) / 4, 5);
  });

  it('counts a half-held record as half, since it is neither', () => {
    const partialOnly = resolveDiscography(
      [DISCOGRAPHY[1]!],
      [{ key: 'b', title: 'Wish You Were Here', trackCount: 3 }],
    );
    expect(summariseDiscography(partialOnly).completion).toBe(0.5);
  });

  it('says nothing about an empty discography rather than dividing by zero', () => {
    expect(summariseDiscography([]).completion).toBe(0);
  });
});

describe('downloadCandidates', () => {
  const held: HeldRelease[] = [{ key: 'a', title: 'Animals', trackCount: 5 }];

  it('offers only what is not already owned', () => {
    const candidates = downloadCandidates(resolveDiscography(DISCOGRAPHY, held));
    expect(candidates.map((c) => c.release.id)).not.toContain('3');
  });

  it('puts whole missing records before half-held ones', () => {
    // A gap in a record you already started is more annoying than one you never had, but the
    // missing ones are what somebody following an artist actually came for.
    const partial: HeldRelease[] = [
      { key: 'b', title: 'Wish You Were Here', trackCount: 3 },
    ];
    const candidates = downloadCandidates(resolveDiscography(DISCOGRAPHY, partial));
    expect(candidates[0]!.state).toBe('missing');
    expect(candidates.map((c) => c.state)).toContain('partial');
  });

  it('pushes compilations below the main run without dropping them', () => {
    /*
     * A compilation is usually not what somebody means by "everything they made" — but deciding
     * that for them would be inventing a rule they never asked for.
     */
    const candidates = downloadCandidates(resolveDiscography(DISCOGRAPHY, held));
    expect(candidates[candidates.length - 1]!.release.kind).toBe('compilation');
    expect(candidates.map((c) => c.release.id)).toContain('4');
  });

  it('offers the newest first, because a followed artist is one whose new work you want', () => {
    const candidates = downloadCandidates(resolveDiscography(DISCOGRAPHY, held));
    const albums = candidates.filter((c) => c.release.kind === 'album');
    expect(albums.map((c) => c.release.year)).toEqual([1975, 1973]);
  });

  it('offers nothing when the collection is complete', () => {
    const all: HeldRelease[] = DISCOGRAPHY.map((r, i) => ({
      key: String(i),
      title: r.title,
      trackCount: r.trackCount ?? 1,
    }));
    expect(downloadCandidates(resolveDiscography(DISCOGRAPHY, all))).toEqual([]);
  });
});
