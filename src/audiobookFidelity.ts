/**
 * Is this audio actually the whole book?
 *
 * Project Gutenberg stores audiobooks as loose directories of per-chapter files, and Gutendex maps
 * the `audio/mpeg` key to just one of them. So a five-hour novel arrives as a single URL, the
 * player measures that one file, and the catalog card says "1 chapter · 16:50" — a complete
 * fabrication produced entirely by honest components.
 *
 * The check is a plausibility argument rather than a measurement: the text of a book has a length,
 * a narrator has a rate, and the product of the two should be within sight of the audio duration.
 * A ratio far below one says the audio cannot be the whole book, whatever the catalog claims.
 *
 * Deliberately not called verification. It cannot prove an audiobook is complete — only that a
 * particular entry is implausible. That asymmetry is why the uncertain case is its own verdict
 * instead of being folded into either answer.
 */

/** Bytes per word: ~5 characters plus a separator, for single-byte English source text. */
export const BYTES_PER_WORD = 6;

/** Words per minute for narrated prose. Audiobook narration clusters near this. */
export const NARRATION_WPM = 155;

/**
 * Below this fraction of the expected duration, the audio is a fragment.
 *
 * Set low on purpose. Abridgements, dual-language editions and brisk narrators all shorten real
 * audiobooks, and calling a genuine recording a sample is worse than missing a fragment: one
 * hides a real book, the other shows a caveat.
 */
export const FIDELITY_SAMPLE_RATIO = 0.25;

export type AudiobookFidelity =
  /** Plausibly the whole work. */
  | 'complete'
  /** Far too short for its text — a fragment or excerpt. */
  | 'sample'
  /** Not enough information to say. Never presented as either. */
  | 'unverified';

export interface FidelityInput {
  /** Byte length of the source text, from a HEAD request rather than a download. */
  textBytes?: number | null;
  /** Duration the player actually measured, in seconds. */
  actualSeconds?: number | null;
  /** Chapters the catalog claims. A multi-chapter listing is evidence in itself. */
  chapterCount?: number | null;
  wordsPerMinute?: number;
}

export function estimateWordsFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / BYTES_PER_WORD);
}

/** Expected narration length of a text of this size, in seconds. */
export function expectedNarrationSeconds(textBytes: number, wordsPerMinute = NARRATION_WPM): number {
  const words = estimateWordsFromBytes(textBytes);
  if (words <= 0 || wordsPerMinute <= 0) return 0;
  return Math.round((words / wordsPerMinute) * 60);
}

/** Measured duration over expected duration; null when either side is unknown. */
export function fidelityRatio(input: FidelityInput): number | null {
  const expected = expectedNarrationSeconds(input.textBytes ?? 0, input.wordsPerMinute);
  const actual = input.actualSeconds ?? 0;
  if (expected <= 0 || actual <= 0) return null;
  return actual / expected;
}

/**
 * Classify an entry.
 *
 * A listing with several chapters is treated as complete without measuring: the fault this exists
 * for is specifically a *single* file standing in for a whole book, and a real multi-chapter
 * manifest is not that. Without a text size or a duration the answer is `unverified` — the point
 * is to stop presenting unknowns as facts, not to replace one confident claim with another.
 */
export function classifyAudiobookFidelity(input: FidelityInput): AudiobookFidelity {
  const chapters = input.chapterCount ?? 0;
  if (chapters > 1) return 'complete';

  const ratio = fidelityRatio(input);
  if (ratio === null) return 'unverified';
  return ratio < FIDELITY_SAMPLE_RATIO ? 'sample' : 'complete';
}

/**
 * Whether an entry may appear in Featured.
 *
 * Featured is a recommendation, and recommending a fragment as a novel is the failure this whole
 * module exists to prevent. Unverified entries stay out too: a shelf that promises books should
 * not be padded with things nobody has checked.
 */
export function canFeatureAudiobook(fidelity: AudiobookFidelity): boolean {
  return fidelity === 'complete';
}

/**
 * Byte length of a text URL, from a HEAD request.
 *
 * A HEAD costs a header exchange; downloading a novel to count its bytes would cost megabytes on
 * a phone to answer a question about a number the server already knows. Returns null on anything
 * unexpected — a missing Content-Length, a redirect that drops it, CORS, or an offline device —
 * because "unknown" has its own verdict and must not be mistaken for "short".
 */
export async function fetchTextByteLength(url: string): Promise<number | null> {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(trimmed, { method: 'HEAD' });
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}
