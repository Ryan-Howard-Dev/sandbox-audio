/**
 * What a file dropped into the incoming folder is, and where it should go.
 *
 * The whole risk of an automatic importer is that it is confident and wrong. A file filed into the
 * wrong station under an invented artist is worse than one left sitting in a folder, because
 * nobody goes looking for a mistake they were never told about — it is found a year later, if at
 * all, and by then it has been synced everywhere.
 *
 * So this refuses more than it files. Anything it cannot identify from the file's own tags goes to
 * quarantine with the reason, and the reason is a sentence somebody can act on rather than a
 * failure code. Guessing from a filename is specifically not done: "01 - track.mp3" is not a title
 * and "Various" is not an artist, and a library that believes otherwise is wrong in a way that
 * looks tidy.
 *
 * Pure. Reading tags is the Rust side, moving files is the filesystem layer, and this only decides.
 */

import type { RootKind } from './libraryFs';
import { renderScheme, type OrganiseTrack } from './libraryOrganise';

/** What could be read from the file itself. Absent fields are absent, never guessed. */
export interface IngestCandidate {
  path: string;
  extension: string;
  /** Seconds, where the file says. Used only to separate a track from a book, never to identify. */
  durationSeconds?: number;
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  releaseYear?: string;
  trackNumber?: number;
  discNumber?: number;
  /** Set on audiobook tags by most tools that make them. */
  narrator?: string;
}

export type QuarantineReason =
  /** No usable tags at all. The commonest case, and the one that must never be guessed. */
  | 'untagged'
  /** Tagged, but missing what the naming scheme needs to place it. */
  | 'incomplete'
  /** Could be two different things and the file does not say which. */
  | 'ambiguousKind'
  /** Not audio, or a format nothing here reads. */
  | 'unsupported'
  /** No library folder of the kind this belongs in. */
  | 'noDestination';

export type IngestDecision =
  | { action: 'file'; kind: RootKind; relativePath: string }
  | { action: 'quarantine'; reason: QuarantineReason; detail: string };

/** Extensions that only ever mean one thing. */
const AUDIOBOOK_EXTENSIONS = new Set(['m4b']);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'flac', 'ogg', 'opus', 'm4a', 'm4b', 'wav', 'aac', 'aiff', 'wma', 'ape', 'wv',
]);
const DOCUMENT_EXTENSIONS = new Set(['epub', 'pdf', 'txt', 'md', 'html']);

/**
 * Long enough that a single file is unlikely to be a song.
 *
 * Twenty minutes. Deliberately not used to decide anything on its own — a twenty minute file is a
 * DJ set as readily as a book chapter, which is exactly the case that gets asked about rather than
 * guessed.
 */
export const LONG_FILE_SECONDS = 20 * 60;

/**
 * Which station a file belongs to, or null where the file does not say clearly enough.
 *
 * Extension first, because it is the only signal that is ever definitive. Everything after it is a
 * hint, and hints are allowed to refuse.
 */
export function classifyKind(candidate: IngestCandidate): RootKind | null {
  const ext = candidate.extension.toLowerCase();

  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (AUDIOBOOK_EXTENSIONS.has(ext)) return 'audiobook';
  if (!AUDIO_EXTENSIONS.has(ext)) return null;

  // A narrator tag is something only audiobook tooling writes, so it is worth more than length.
  if (candidate.narrator?.trim()) return 'audiobook';

  /*
   * A long file with no other signal is the ambiguous case. A ninety minute mp3 is a mix, a lecture
   * or a book chapter, and the file gives no way to tell — so it is asked about rather than filed
   * somewhere plausible.
   */
  if ((candidate.durationSeconds ?? 0) >= LONG_FILE_SECONDS) return null;

  return 'music';
}

export interface IngestOptions {
  /** Naming scheme per station. Missing means that station is not accepting files. */
  schemes: Partial<Record<RootKind, string>>;
}

/**
 * Decide what to do with one dropped file.
 *
 * Files it only when the file itself supplies everything the scheme needs. Everything else is
 * quarantined with a sentence naming what was missing, so the answer to "why is this still sitting
 * there" is on screen rather than in a log.
 */
export function decideIngest(
  candidate: IngestCandidate,
  options: IngestOptions,
): IngestDecision {
  const ext = candidate.extension.toLowerCase();

  if (!AUDIO_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext)) {
    return {
      action: 'quarantine',
      reason: 'unsupported',
      detail: `Nothing here reads .${ext} files`,
    };
  }

  const kind = classifyKind(candidate);
  if (!kind) {
    return {
      action: 'quarantine',
      reason: 'ambiguousKind',
      detail:
        'Long enough to be a mix, a lecture or a book chapter, and the file does not say which',
    };
  }

  const scheme = options.schemes[kind];
  if (!scheme) {
    return {
      action: 'quarantine',
      reason: 'noDestination',
      detail: `No ${kind} folder is set up to receive files`,
    };
  }

  /*
   * Nothing readable at all is its own answer. "Untagged" tells somebody to tag it or match it;
   * "missing album" tells them the file is nearly there. Collapsing both into one message makes
   * the larger pile look like the smaller problem.
   */
  const hasAnything = Boolean(
    candidate.title?.trim() || candidate.artist?.trim() || candidate.album?.trim(),
  );
  if (!hasAnything) {
    return {
      action: 'quarantine',
      reason: 'untagged',
      detail: 'No tags to file it by — match it from the catalogue first',
    };
  }

  const track: OrganiseTrack = {
    path: candidate.path,
    title: candidate.title,
    artist: candidate.artist,
    albumArtist: candidate.albumArtist,
    album: candidate.album,
    releaseYear: candidate.releaseYear,
    trackNumber: candidate.trackNumber,
    discNumber: candidate.discNumber,
  };

  const rendered = renderScheme(scheme, track);
  if (rendered.status === 'missing') {
    return {
      action: 'quarantine',
      reason: 'incomplete',
      detail: `Needs ${rendered.tokens.map((token) => `{${token}}`).join(', ')}`,
    };
  }
  if (rendered.status === 'badScheme') {
    return { action: 'quarantine', reason: 'noDestination', detail: rendered.detail };
  }

  return { action: 'file', kind, relativePath: rendered.relativePath };
}

export interface IngestSummary {
  filed: number;
  quarantined: number;
  /** Counts per reason, so the commonest problem is visible without reading every row. */
  reasons: Partial<Record<QuarantineReason, number>>;
}

export function summariseIngest(decisions: readonly IngestDecision[]): IngestSummary {
  const summary: IngestSummary = { filed: 0, quarantined: 0, reasons: {} };
  for (const decision of decisions) {
    if (decision.action === 'file') {
      summary.filed += 1;
      continue;
    }
    summary.quarantined += 1;
    summary.reasons[decision.reason] = (summary.reasons[decision.reason] ?? 0) + 1;
  }
  return summary;
}

/** One sentence per reason, for a screen that has to explain a pile of held files. */
export function describeQuarantine(reason: QuarantineReason): string {
  switch (reason) {
    case 'untagged':
      return 'No tags to go on';
    case 'incomplete':
      return 'Tagged, but missing fields the naming scheme needs';
    case 'ambiguousKind':
      return 'Could be music or a book — needs a person to say';
    case 'unsupported':
      return 'Not a format this reads';
    case 'noDestination':
      return 'No folder set up to receive it';
  }
}
