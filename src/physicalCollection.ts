/**
 * The records on the shelf, as opposed to the files on the disk.
 *
 * discographyOwnership already answers "of everything this artist made, what do I have" — but it
 * answers it from the locker, so it can only ever see what has been ripped. A collection is not
 * the same set. A pressing you own and have never ripped is missing from the app and present in
 * the room; a rip of something you do not own is the reverse. Both are true at once and the shelf
 * is the half nothing recorded.
 *
 * This is deliberately NOT merged into the file resolver. Telling resolveDiscography that a vinyl
 * counts as held would make "partial" meaningless — a record has no track count until somebody
 * types one, and inventing one to satisfy a comparison is how an app starts lying about what you
 * own. The two are resolved separately and overlaid, so every entry can say which of the two it
 * has, or both, or neither.
 *
 * Pure and storage-free by design. Nothing here fetches, so it can be tested against the awkward
 * cases that actually occur, and the store that persists it is a thin layer above.
 */

import {
  isSameRelease,
  type DiscographyEntry,
  type OwnershipState,
} from './discographyOwnership';

/**
 * What a copy is.
 *
 * 'digital-purchase' earns its place: a bought download is owned in the sense a collection cares
 * about even when the files never reached this device, and lumping it in with 'other' loses the
 * one distinction anybody actually wants to filter on.
 */
export type PhysicalFormat = 'vinyl' | 'cd' | 'cassette' | 'digital-purchase' | 'other';

/** Condition, in the vocabulary collectors already use, so nobody has to learn a new scale. */
export type CopyCondition = 'mint' | 'near-mint' | 'very-good' | 'good' | 'fair' | 'poor';

export interface PhysicalCopy {
  /** Stable local id for this copy — two pressings of one album are two copies. */
  id: string;
  /** Release title as the shelf knows it; matched against the catalogue by isSameRelease. */
  title: string;
  artist: string;
  format: PhysicalFormat;
  /** UPC/EAN from the sleeve, where it was scanned or typed. Not every record has one. */
  barcode?: string;
  condition?: CopyCondition;
  /** Pressing, catalogue number, where it was bought — whatever the owner wants to remember. */
  notes?: string;
  /** When it was added to the collection, not when the record was released. */
  addedAt: number;
  /**
   * When it was last edited, for cross-device merge.
   *
   * Optional so rows written before sync existed still load. mergePhysicalCollection falls back to
   * addedAt rather than treating them as infinitely old and losing every merge.
   */
  updatedAt?: number;
}

/** What a listener has of one release, counting both the disk and the room. */
export type Holding = 'none' | 'files' | 'physical' | 'both';

export interface PhysicalDiscographyEntry extends DiscographyEntry {
  holding: Holding;
  /** Every copy owned of this release — a record can be held on more than one format. */
  copies: PhysicalCopy[];
}

/**
 * Fold the shelf into a resolved discography.
 *
 * Matching reuses isSameRelease, so a sleeve reading "Dark Side Of The Moon" finds the catalogue's
 * "The Dark Side of the Moon" for exactly the same reasons the file matcher does — and gets the
 * same deliberate refusal to collapse a live album into the studio one.
 */
export function overlayPhysicalOwnership(
  entries: readonly DiscographyEntry[],
  copies: readonly PhysicalCopy[],
): PhysicalDiscographyEntry[] {
  return entries.map((entry) => {
    const matched = copies.filter((copy) => isSameRelease(copy.title, entry.release.title));
    return {
      ...entry,
      copies: matched,
      holding: holdingFor(entry.state, matched.length > 0),
    };
  });
}

/**
 * Copies of releases the catalogue never listed.
 *
 * A collection contains things no artist discography will return — a compilation, a bootleg, a
 * record by somebody else entirely. Dropping them because they did not match would quietly delete
 * part of somebody's collection from their own view of it, so they are handed back to be shown
 * rather than swallowed.
 */
export function unmatchedCopies(
  entries: readonly DiscographyEntry[],
  copies: readonly PhysicalCopy[],
): PhysicalCopy[] {
  return copies.filter(
    (copy) => !entries.some((entry) => isSameRelease(copy.title, entry.release.title)),
  );
}

function holdingFor(state: OwnershipState, hasCopy: boolean): Holding {
  const onDisk = state === 'owned' || state === 'partial';
  if (onDisk && hasCopy) return 'both';
  if (onDisk) return 'files';
  if (hasCopy) return 'physical';
  return 'none';
}

export interface CollectionSummary {
  copies: number;
  releases: number;
  byFormat: Record<PhysicalFormat, number>;
  /** Owned on the shelf and not ripped — the list that answers "what should I rip next". */
  physicalOnly: number;
  /** Ripped and not owned on the shelf — what a collector might want to go and buy. */
  filesOnly: number;
}

export function summarisePhysicalCollection(
  entries: readonly PhysicalDiscographyEntry[],
  copies: readonly PhysicalCopy[],
): CollectionSummary {
  const byFormat: Record<PhysicalFormat, number> = {
    vinyl: 0,
    cd: 0,
    cassette: 0,
    'digital-purchase': 0,
    other: 0,
  };
  for (const copy of copies) byFormat[copy.format] += 1;

  return {
    copies: copies.length,
    // Copies, not releases: two pressings of one album are two copies of one release.
    releases: entries.filter((e) => e.copies.length > 0).length,
    byFormat,
    physicalOnly: entries.filter((e) => e.holding === 'physical').length,
    filesOnly: entries.filter((e) => e.holding === 'files').length,
  };
}

/**
 * Whether this barcode is worth looking up.
 *
 * UPC-A is twelve digits, EAN-13 thirteen. Anything else came from a mis-scan or a hand-typed
 * slip, and sending it to a catalogue only produces a confident wrong answer some of the time,
 * which is worse than saying it did not scan.
 */
export function isPlausibleBarcode(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 12 || digits.length === 13;
}

/** Digits only, so a scan with spaces or hyphens matches one typed without. */
export function normaliseBarcode(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Whether this barcode is already on the shelf, so a second scan does not duplicate a record. */
export function findCopyByBarcode(
  copies: readonly PhysicalCopy[],
  barcode: string,
): PhysicalCopy | null {
  const wanted = normaliseBarcode(barcode);
  if (!wanted) return null;
  return copies.find((copy) => copy.barcode && normaliseBarcode(copy.barcode) === wanted) ?? null;
}
