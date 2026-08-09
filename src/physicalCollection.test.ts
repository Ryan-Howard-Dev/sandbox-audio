import { describe, expect, it } from 'vitest';
import { resolveDiscography, type CatalogueRelease, type HeldRelease } from './discographyOwnership';
import {
  findCopyByBarcode,
  isPlausibleBarcode,
  normaliseBarcode,
  overlayPhysicalOwnership,
  summarisePhysicalCollection,
  unmatchedCopies,
  type PhysicalCopy,
} from './physicalCollection';

const CATALOGUE: CatalogueRelease[] = [
  { id: 'r1', title: 'The Dark Side of the Moon', year: 1973, trackCount: 10, kind: 'album' },
  { id: 'r2', title: 'Wish You Were Here', year: 1975, trackCount: 5, kind: 'album' },
  { id: 'r3', title: 'Animals', year: 1977, trackCount: 5, kind: 'album' },
];

function copy(overrides: Partial<PhysicalCopy> = {}): PhysicalCopy {
  return {
    id: 'c1',
    title: 'The Dark Side of the Moon',
    artist: 'Pink Floyd',
    format: 'vinyl',
    addedAt: 1,
    ...overrides,
  };
}

describe('the shelf and the disk are different questions', () => {
  it('reports a record owned on vinyl and never ripped', () => {
    /*
     * The case the file resolver cannot see and the whole reason this exists: it is in the room
     * and absent from the app, and calling that "missing" is wrong to the person holding it.
     */
    const entries = resolveDiscography(CATALOGUE, []);
    const out = overlayPhysicalOwnership(entries, [copy()]);
    expect(out[0]!.holding).toBe('physical');
    expect(out[0]!.copies).toHaveLength(1);
  });

  it('reports a record ripped and not owned', () => {
    const held: HeldRelease[] = [
      { key: 'k1', title: 'The Dark Side of the Moon', trackCount: 10 },
    ];
    const out = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, held), []);
    expect(out[0]!.holding).toBe('files');
  });

  it('reports a record held both ways', () => {
    const held: HeldRelease[] = [
      { key: 'k1', title: 'The Dark Side of the Moon', trackCount: 10 },
    ];
    const out = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, held), [copy()]);
    expect(out[0]!.holding).toBe('both');
  });

  it('reports a record held neither way', () => {
    const out = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, []), []);
    expect(out[2]!.holding).toBe('none');
  });

  it('counts a half-ripped record as on disk as well as on the shelf', () => {
    // Partial is still a holding. "I have some of it and the record" is not "I have only the record".
    const held: HeldRelease[] = [
      { key: 'k1', title: 'The Dark Side of the Moon', trackCount: 4 },
    ];
    const out = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, held), [copy()]);
    expect(out[0]!.state).toBe('partial');
    expect(out[0]!.holding).toBe('both');
  });
});

describe('matching a sleeve to a catalogue', () => {
  it('matches through the punctuation and articles a sleeve prints differently', () => {
    const out = overlayPhysicalOwnership(
      resolveDiscography(CATALOGUE, []),
      [copy({ title: 'DARK SIDE OF THE MOON' })],
    );
    expect(out[0]!.holding).toBe('physical');
  });

  it('does not collapse a live record into the studio one', () => {
    /*
     * Inherited from isSameRelease on purpose. A live album is a different record, and counting it
     * as the studio album tells somebody they own something they do not.
     */
    const out = overlayPhysicalOwnership(
      resolveDiscography(CATALOGUE, []),
      [copy({ title: 'Animals (Live)' })],
    );
    expect(out[2]!.holding).toBe('none');
  });

  it('keeps two pressings of one record as two copies', () => {
    const out = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, []), [
      copy({ id: 'c1', format: 'vinyl' }),
      copy({ id: 'c2', format: 'cd' }),
    ]);
    expect(out[0]!.copies).toHaveLength(2);
  });
});

describe('copies the catalogue never listed', () => {
  it('hands them back rather than swallowing them', () => {
    /*
     * Bootlegs, compilations, records by somebody else. Dropping an unmatched copy would delete
     * part of a collection from its owner's view of it without saying so.
     */
    const stray = copy({ id: 'c9', title: 'Some Bootleg Nobody Catalogued' });
    expect(unmatchedCopies(resolveDiscography(CATALOGUE, []), [copy(), stray])).toEqual([stray]);
  });
});

describe('what the collection adds up to', () => {
  it('counts copies, releases and formats apart', () => {
    const copies = [
      copy({ id: 'c1', format: 'vinyl' }),
      copy({ id: 'c2', format: 'cd' }),
      copy({ id: 'c3', title: 'Wish You Were Here', format: 'vinyl' }),
    ];
    const entries = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, []), copies);
    const summary = summarisePhysicalCollection(entries, copies);
    expect(summary.copies).toBe(3);
    // Two records, three copies — one of them owned twice.
    expect(summary.releases).toBe(2);
    expect(summary.byFormat.vinyl).toBe(2);
    expect(summary.byFormat.cd).toBe(1);
  });

  it('answers what to rip next and what to go and buy', () => {
    const held: HeldRelease[] = [{ key: 'k1', title: 'Animals', trackCount: 5 }];
    const copies = [copy()];
    const entries = overlayPhysicalOwnership(resolveDiscography(CATALOGUE, held), copies);
    const summary = summarisePhysicalCollection(entries, copies);
    // Owned on vinyl, never ripped.
    expect(summary.physicalOnly).toBe(1);
    // Ripped, not on the shelf.
    expect(summary.filesOnly).toBe(1);
  });
});

describe('barcodes', () => {
  it('accepts UPC-A and EAN-13 and nothing else', () => {
    expect(isPlausibleBarcode('012345678905')).toBe(true);
    expect(isPlausibleBarcode('5099902988665')).toBe(true);
    // A mis-scan sent to a catalogue produces a confident wrong answer some of the time, which is
    // worse than reporting that it did not scan.
    expect(isPlausibleBarcode('1234')).toBe(false);
    expect(isPlausibleBarcode('')).toBe(false);
    expect(isPlausibleBarcode('12345678901234')).toBe(false);
  });

  it('reads a scan with separators the same as one typed without', () => {
    expect(normaliseBarcode('5 099902 988665')).toBe('5099902988665');
    expect(normaliseBarcode('012-345-678-905')).toBe('012345678905');
    expect(isPlausibleBarcode('5 099902 988665')).toBe(true);
  });

  it('finds a record already on the shelf so a second scan does not duplicate it', () => {
    const copies = [copy({ barcode: '5099902988665' })];
    expect(findCopyByBarcode(copies, '5 099902 988665')?.id).toBe('c1');
    expect(findCopyByBarcode(copies, '0000000000000')).toBeNull();
  });

  it('ignores copies with no barcode rather than matching them to everything', () => {
    expect(findCopyByBarcode([copy()], '5099902988665')).toBeNull();
    expect(findCopyByBarcode([copy({ barcode: '5099902988665' })], '')).toBeNull();
  });
});
