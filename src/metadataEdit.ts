/**
 * Choosing correct metadata, rather than guessing at it.
 *
 * metadataRepair already fixes six kinds of problem automatically, and automatic is the right
 * default for a library of forty thousand files. It is the wrong answer for the record it gets
 * wrong: a reissue matched to the original, a self-titled album matched to the wrong band. This is
 * the other half — search the catalogue, look at what a candidate would change, and apply it only
 * if it is right.
 *
 * Same shape as the filesystem layer, for the same reason: propose, look, then apply. Everything
 * here is pure. It takes rows and a candidate and returns what would change; it performs no edit
 * and fetches nothing.
 */

/** The fields this editor is willing to touch. Deliberately not every field a locker row has. */
export type EditableField =
  | 'title'
  | 'artist'
  | 'albumName'
  | 'albumArtist'
  | 'releaseYear'
  | 'trackNumber'
  | 'discNumber'
  | 'genre'
  | 'albumArt';

/** What a locker row looks like to this module. Kept narrow so tests need no locker. */
export interface EditableRow {
  id: string;
  title: string;
  artist: string;
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  trackNumber?: number;
  discNumber?: number;
  genre?: string;
  albumArt?: string;
  /** Set by hand in Edit info. Means: this is right, leave it alone. */
  userMetadataLocked?: boolean;
}

/** One track as the catalogue describes it. */
export interface CandidateTrack {
  title: string;
  trackNumber: number;
  discNumber?: number;
  /** Seconds, where the catalogue knows. Used only for matching, never written. */
  durationSeconds?: number;
}

/** A release the catalogue offered as a match. */
export interface ReleaseCandidate {
  id: string;
  title: string;
  artist: string;
  year?: string;
  genre?: string;
  coverArtUrl?: string;
  tracks: CandidateTrack[];
  /** 'CD', 'Vinyl' — shown so two pressings of one album can be told apart. */
  media?: string;
  trackCount?: number;
}

export interface FieldChange {
  field: EditableField;
  before: string | undefined;
  after: string;
}

/** Why a row is not being changed, when it is not. */
export type SkipReason =
  /** The row carries userMetadataLocked. Somebody said this was right. */
  | 'locked'
  /** Nothing in the candidate matched this row. */
  | 'unmatched'
  /** Everything the candidate offers, the row already has. */
  | 'alreadyCorrect';

export interface RowEdit {
  rowId: string;
  /** What the row shows now, for a preview that has to name it. */
  label: string;
  changes: FieldChange[];
  skipped?: SkipReason;
  /** Which catalogue track this row was matched to, when it was. */
  matchedTrack?: CandidateTrack;
}

export interface EditProposal {
  candidateId: string;
  edits: RowEdit[];
  /** Rows that would actually change. */
  changing: number;
  /** Rows left alone, for any reason. */
  skipped: number;
  /** Total field changes across every row. */
  fieldChanges: number;
}

export interface ProposeOptions {
  /**
   * Overwrite fields the row already has a value for.
   *
   * Off by default: filling blanks is nearly always wanted, and replacing a title somebody may have
   * corrected by hand is nearly always not. Turning it on is how you fix a row that is wrong rather
   * than merely incomplete.
   */
  overwriteExisting?: boolean;
  /** Fields to leave alone entirely, whatever else is asked for. */
  exclude?: readonly EditableField[];
  /**
   * Apply to locked rows too.
   *
   * The lock exists so automatic repair cannot undo hand corrections. A person who has searched,
   * chosen a release and is looking at the diff is not automatic repair, so this is offerable —
   * but never the default.
   */
  includeLocked?: boolean;
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Which catalogue track a row is.
 *
 * Track number first, because it is what a rip gets right even when the tags are otherwise empty.
 * Title second, so a row with no number still lands. Nothing else: matching on duration alone
 * pairs unrelated three minute songs, and a wrong match writes a wrong title, which is worse than
 * leaving the row alone.
 */
export function matchTrack(
  row: EditableRow,
  tracks: readonly CandidateTrack[],
): CandidateTrack | undefined {
  if (row.trackNumber != null) {
    const sameDisc = tracks.filter(
      (t) => row.discNumber == null || (t.discNumber ?? 1) === row.discNumber,
    );
    const byNumber = sameDisc.find((t) => t.trackNumber === row.trackNumber);
    if (byNumber) return byNumber;
  }
  const rowTitle = normalize(row.title);
  if (!rowTitle) return undefined;
  return tracks.find((t) => normalize(t.title) === rowTitle);
}

function wants(
  current: string | undefined,
  next: string | undefined,
  overwrite: boolean,
): next is string {
  if (next == null || next.trim() === '') return false;
  const has = current != null && String(current).trim() !== '';
  if (has && !overwrite) return false;
  return normalize(String(current)) !== normalize(next);
}

/**
 * What applying this candidate to these rows would change.
 *
 * Every row is reported, including the ones left alone and why. A preview that lists only what it
 * intends to touch cannot be checked for what it has wrongly decided to skip.
 */
export function proposeEdits(
  rows: readonly EditableRow[],
  candidate: ReleaseCandidate,
  options: ProposeOptions = {},
): EditProposal {
  const overwrite = options.overwriteExisting ?? false;
  const excluded = new Set(options.exclude ?? []);
  const includeLocked = options.includeLocked ?? false;

  const edits: RowEdit[] = rows.map((row) => {
    const label = row.title || row.id;

    if (row.userMetadataLocked && !includeLocked) {
      return { rowId: row.id, label, changes: [], skipped: 'locked' };
    }

    const track = matchTrack(row, candidate.tracks);
    if (!track) {
      return { rowId: row.id, label, changes: [], skipped: 'unmatched' };
    }

    const proposed: Array<[EditableField, string | undefined, string | undefined]> = [
      ['title', row.title, track.title],
      ['artist', row.artist, candidate.artist],
      ['albumName', row.albumName, candidate.title],
      ['albumArtist', row.albumArtist, candidate.artist],
      ['releaseYear', row.releaseYear, candidate.year],
      ['trackNumber', numberText(row.trackNumber), String(track.trackNumber)],
      ['discNumber', numberText(row.discNumber), numberText(track.discNumber)],
      ['genre', row.genre, candidate.genre],
      ['albumArt', row.albumArt, candidate.coverArtUrl],
    ];

    const changes: FieldChange[] = [];
    for (const [field, before, after] of proposed) {
      if (excluded.has(field)) continue;
      if (!wants(before, after, overwrite)) continue;
      changes.push({ field, before: before ?? undefined, after });
    }

    if (changes.length === 0) {
      return { rowId: row.id, label, changes: [], skipped: 'alreadyCorrect', matchedTrack: track };
    }
    return { rowId: row.id, label, changes, matchedTrack: track };
  });

  const changing = edits.filter((e) => e.changes.length > 0).length;
  return {
    candidateId: candidate.id,
    edits,
    changing,
    skipped: edits.length - changing,
    fieldChanges: edits.reduce((sum, e) => sum + e.changes.length, 0),
  };
}

function numberText(value: number | undefined): string | undefined {
  return value == null ? undefined : String(value);
}

/**
 * The patch to hand a store, for one row.
 *
 * Returned separately from the proposal so applying is a mechanical translation of something
 * already shown, rather than a second decision made at write time that could differ from what the
 * preview promised.
 */
export function patchForEdit(edit: RowEdit): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  for (const change of edit.changes) {
    if (change.field === 'trackNumber' || change.field === 'discNumber') {
      const parsed = Number.parseInt(change.after, 10);
      if (Number.isFinite(parsed)) patch[change.field] = parsed;
      continue;
    }
    patch[change.field] = change.after;
  }
  return patch;
}

/**
 * How well a candidate fits, from 0 to 1, for ordering search results.
 *
 * Track count carries the most weight because it is the thing that separates an album from its
 * deluxe reissue, which is the mistake that matters here — every title and artist matches on both,
 * and picking the wrong one writes bonus-disc track numbers over the original.
 */
export function scoreCandidate(
  candidate: ReleaseCandidate,
  against: { album?: string; artist?: string; trackCount?: number },
): number {
  let score = 0;
  let weight = 0;

  if (against.album) {
    weight += 3;
    if (normalize(candidate.title) === normalize(against.album)) score += 3;
    else if (normalize(candidate.title).includes(normalize(against.album))) score += 1.5;
  }
  if (against.artist) {
    weight += 3;
    if (normalize(candidate.artist) === normalize(against.artist)) score += 3;
  }
  if (against.trackCount != null) {
    weight += 4;
    const count = candidate.trackCount ?? candidate.tracks.length;
    if (count === against.trackCount) score += 4;
    else if (Math.abs(count - against.trackCount) <= 1) score += 2;
  }

  return weight === 0 ? 0 : score / weight;
}

/** Order candidates best first, leaving equal ones in the order the catalogue gave them. */
export function rankCandidates(
  candidates: readonly ReleaseCandidate[],
  against: { album?: string; artist?: string; trackCount?: number },
): ReleaseCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, against) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.candidate);
}
