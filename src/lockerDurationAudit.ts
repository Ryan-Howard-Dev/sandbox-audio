/**
 * Catching a file that is not the track it claims to be, by listening to how long it actually is.
 *
 * Mobile acquisition stamps the catalog's duration onto the locker row rather than measuring the
 * audio. The existing suspect detector then compares that stored duration against the catalog's,
 * so for anything acquired on the phone it is comparing a number with a copy of itself and can
 * never disagree. It is blind to exactly the files it was built to find.
 *
 * Measured on a real phone: a locker row titled Vultures, credited correctly, album correct,
 * stored duration 276 seconds. The audio ran 3945 -- sixty-six minutes, a whole album filed under
 * one song's name, which is why tapping the track played something else entirely.
 *
 * The player already knows the truth. ExoPlayer reports the real length of whatever it opened, so
 * the first time a file is played its actual duration can be compared against what the library
 * claims. That needs no probe, no native call and no network: the number arrives anyway.
 *
 * Nothing is deleted here, and nothing is refused. This records that a row and its file disagree
 * so the library can say so and offer to fetch it again. Deleting audio stays the listener's
 * decision.
 */

/**
 * How far a file may run from its stated length before it is a different recording.
 *
 * Deliberately tight. Encoders, silence trimming and different masters move a song by seconds;
 * they do not double it. The looser download band exists to avoid refusing correct files, and a
 * false positive here costs a row on a list rather than a track that will not play.
 */
export const FILE_DURATION_MIN_RATIO = 0.85;
export const FILE_DURATION_MAX_RATIO = 1.15;

/** Below this a stated duration is too short to reason about, so this abstains. */
const MIN_COMPARABLE_SECONDS = 20;

/**
 * True when the audio does not run for anything like the length the library claims.
 *
 * Abstains when either side is unknown or trivially short: a missing duration is not evidence of
 * a wrong file, and refusing to abstain would flag every stream that fails to report one.
 */
export function fileDurationContradictsMetadata(
  statedSeconds: number | undefined,
  actualSeconds: number | undefined,
): boolean {
  const stated = statedSeconds ?? 0;
  const actual = actualSeconds ?? 0;
  if (stated < MIN_COMPARABLE_SECONDS || actual < MIN_COMPARABLE_SECONDS) return false;
  const ratio = actual / stated;
  return ratio < FILE_DURATION_MIN_RATIO || ratio > FILE_DURATION_MAX_RATIO;
}

/** A row whose file has been heard to disagree with it. */
export type DurationMismatch = {
  envelopeId: string;
  title: string;
  artist: string;
  statedSeconds: number;
  actualSeconds: number;
  /** When it was noticed, so the newest are kept if the list is ever trimmed. */
  at: number;
};

const STORAGE_KEY = 'sandbox_locker_duration_mismatch_v1';
/** Small on purpose: this is a list somebody reads, not a log. */
const MAX_RECORDED = 200;

function read(): DurationMismatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as DurationMismatch[]) : [];
  } catch {
    return [];
  }
}

function write(rows: DurationMismatch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RECORDED)));
  } catch {
    /* A lost record means the mismatch is noticed again next time it plays, not a crash. */
  }
}

/**
 * Note that a file disagreed with its row. Returns true when this was news.
 *
 * Keyed by envelope so playing the same wrong file twice does not report it twice, and so the
 * figures stay the most recent ones rather than the first ever seen.
 */
export function recordDurationMismatch(entry: Omit<DurationMismatch, 'at'>): boolean {
  const rows = read();
  const existing = rows.findIndex((r) => r.envelopeId === entry.envelopeId);
  const row: DurationMismatch = { ...entry, at: Date.now() };
  if (existing >= 0) {
    rows[existing] = row;
    write(rows);
    return false;
  }
  write([row, ...rows]);
  return true;
}

/** Everything heard to disagree so far, newest first. */
export function listDurationMismatches(): DurationMismatch[] {
  return read();
}

/** Forget a row, for one that has been re-acquired or accepted as correct. */
export function clearDurationMismatch(envelopeId: string): void {
  write(read().filter((r) => r.envelopeId !== envelopeId));
}

/**
 * Compare what is playing against what the library said, and record a disagreement.
 *
 * Returns the mismatch when there is one, so a caller can also say something at the time.
 */
export function auditPlayingDuration(input: {
  envelopeId?: string;
  title?: string;
  artist?: string;
  statedSeconds?: number;
  actualSeconds?: number;
}): DurationMismatch | null {
  const envelopeId = input.envelopeId?.trim();
  if (!envelopeId) return null;
  if (!fileDurationContradictsMetadata(input.statedSeconds, input.actualSeconds)) return null;
  const row: DurationMismatch = {
    envelopeId,
    title: input.title?.trim() || '',
    artist: input.artist?.trim() || '',
    statedSeconds: Math.round(input.statedSeconds ?? 0),
    actualSeconds: Math.round(input.actualSeconds ?? 0),
    at: Date.now(),
  };
  recordDurationMismatch(row);
  return row;
}
