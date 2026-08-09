/**
 * What you actually have of an artist, release by release.
 *
 * Following an artist is only useful if it answers a question, and the question is always the
 * same: of everything they made, what do I own, what am I missing, and what have I got half of?
 * A follow list that cannot answer that is a bookmark.
 *
 * The hard part is not the arithmetic, it is the matching. A catalogue says "The Dark Side of the
 * Moon"; the file on disk says "Dark Side Of The Moon [2011 Remaster]". Neither is wrong. Titles
 * arrive from MusicBrainz, from ID3 tags typed by a stranger, from a folder name, and from a
 * shop's metadata, and no two agree on punctuation, articles, case, or what belongs in brackets.
 * Matching them is where this earns its keep and where it will be wrong, so the comparison is
 * written to be read and argued with rather than buried in a component.
 *
 * Deliberately pure. It takes a discography and a list of what is held, and returns state. It
 * fetches nothing, so it can be tested against the awkward pairs that actually occur.
 */

/** A release as a catalogue describes it. */
export interface CatalogueRelease {
  id: string;
  title: string;
  /** Year of first release, where the catalogue states one. */
  year?: number;
  /** How many tracks the release has, where known. Zero means the catalogue did not say. */
  trackCount?: number;
  /** Studio album, EP, live, compilation — used to let a view separate the main run. */
  kind?: 'album' | 'ep' | 'single' | 'live' | 'compilation' | 'other';
}

/** An album as the locker actually holds it. */
export interface HeldRelease {
  key: string;
  title: string;
  /** Tracks present on disk. */
  trackCount: number;
}

export type OwnershipState = 'owned' | 'partial' | 'missing';

export interface DiscographyEntry {
  release: CatalogueRelease;
  state: OwnershipState;
  /** Tracks held, zero when missing. */
  heldTracks: number;
  /** Tracks the catalogue says exist, zero when it did not say. */
  catalogueTracks: number;
  /** The locker album this was matched to, for a view that wants to open it. */
  heldKey: string | null;
}

/**
 * Strip a title down to what two sources can be expected to agree on.
 *
 * Everything removed here is something one catalogue includes and another does not:
 *
 *   Bracketed suffixes — "[2011 Remaster]", "(Deluxe Edition)", "(Remastered)". A remaster is
 *   the same record; treating it as a different one tells somebody they are missing an album
 *   they have been listening to for years.
 *
 *   Leading articles — "The Beatles" against "Beatles". Both are written, neither is wrong.
 *
 *   Punctuation and case — apostrophes are typed four different ways, and half the files on any
 *   real device are in capitals.
 *
 * What is deliberately NOT removed is anything that changes which record it is. "Live at Leeds"
 * keeps "Live"; a live album is not the studio album, and collapsing them would report an album
 * owned that is not.
 */
/**
 * Bracketed words that mean this is a different recording, not a different pressing.
 *
 * Everything else in brackets — remaster, deluxe, anniversary, a year — describes the same
 * performance packaged differently, and stripping it is what lets a sleeve match a catalogue. These
 * do not. "Animals (Live)" is not "Animals", and collapsing them tells a collector they own a
 * studio album when what is on the shelf is the live one, which is precisely the confident wrong
 * answer this file exists to avoid. The unbracketed case was already handled; brackets were the
 * hole, and a physical shelf is full of them.
 */
const DIFFERENT_RECORDING_RE =
  /\b(live|demos?|acoustic|instrumental|karaoke|a cappella|acapella|radio edit|rehearsals?|sessions?)\b/i;

export function normaliseReleaseTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    /*
     * Bracketed and parenthesised qualifiers, wherever they sit — unless the bracket says this is
     * a different recording, in which case the words stay and the two titles stop matching.
     */
    .replace(/[[(][^\])]*[\])]/g, (match) =>
      DIFFERENT_RECORDING_RE.test(match) ? ` ${match.replace(/[[\]()]/g, ' ')} ` : ' ',
    )
    // Trailing edition words a shop appends without brackets.
    .replace(/\b(remaster(ed)?|deluxe|expanded|anniversary|edition|version|mono|stereo)\b/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether two titles name the same record, as far as anything here can tell. */
export function isSameRelease(a: string, b: string): boolean {
  const left = normaliseReleaseTitle(a);
  const right = normaliseReleaseTitle(b);
  if (!left || !right) return false;
  return left === right;
}

/**
 * The artist's discography, marked with what is held.
 *
 * 'partial' needs a real track count from both sides to mean anything. Where the catalogue does
 * not say how many tracks a release has — which is common outside well-curated data — holding any
 * of it counts as owned, because "you have 9 of unknown" is not a thing worth showing anyone.
 */
export function resolveDiscography(
  discography: readonly CatalogueRelease[],
  held: readonly HeldRelease[],
): DiscographyEntry[] {
  return discography.map((release) => {
    const match = held.find((candidate) => isSameRelease(candidate.title, release.title)) ?? null;
    const catalogueTracks = Math.max(0, Math.round(release.trackCount ?? 0));
    const heldTracks = match ? Math.max(0, Math.round(match.trackCount)) : 0;

    let state: OwnershipState;
    if (!match || heldTracks === 0) {
      state = 'missing';
    } else if (catalogueTracks > 0 && heldTracks < catalogueTracks) {
      state = 'partial';
    } else {
      state = 'owned';
    }

    return {
      release,
      state,
      heldTracks,
      catalogueTracks,
      heldKey: match?.key ?? null,
    };
  });
}

export interface DiscographySummary {
  owned: number;
  partial: number;
  missing: number;
  total: number;
  /** 0..1 by release, not by track — "you have 7 of their 12 records". */
  completion: number;
}

/**
 * How complete a collection is.
 *
 * Counted in releases rather than tracks on purpose. Somebody with every album except one
 * fourteen-track compilation has a complete collection in the sense they care about, and
 * counting tracks would tell them they are at 78%.
 *
 * Partial releases count as half. Neither having a record nor not having it, and rounding either
 * way misreports the shelf.
 */
export function summariseDiscography(entries: readonly DiscographyEntry[]): DiscographySummary {
  let owned = 0;
  let partial = 0;
  let missing = 0;
  for (const entry of entries) {
    if (entry.state === 'owned') owned += 1;
    else if (entry.state === 'partial') partial += 1;
    else missing += 1;
  }
  const total = entries.length;
  return {
    owned,
    partial,
    missing,
    total,
    completion: total > 0 ? (owned + partial * 0.5) / total : 0,
  };
}

/**
 * What is worth offering to download.
 *
 * Missing releases first, then the ones half-held — a gap in a record you already started is
 * more annoying than a record you never had. Newest first inside each, because an artist you
 * follow is one whose new work you want.
 *
 * Compilations and singles are pushed below the main run rather than dropped: they are usually
 * not what somebody means by "everything they made", but deciding that for them would be
 * inventing a rule they did not ask for.
 */
export function downloadCandidates(entries: readonly DiscographyEntry[]): DiscographyEntry[] {
  const wanted = entries.filter((e) => e.state !== 'owned');
  const rank = (e: DiscographyEntry) => {
    const secondary = e.release.kind === 'compilation' || e.release.kind === 'single' ? 1 : 0;
    return secondary * 10 + (e.state === 'missing' ? 0 : 1);
  };
  return [...wanted].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (b.release.year ?? 0) - (a.release.year ?? 0);
  });
}
