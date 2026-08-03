/**
 * Where to actually resume, as opposed to where you stopped.
 *
 * Positions are saved to the second and restored to the second, which is right for a track and
 * wrong for anything spoken. Coming back to a two hour episode after three days and being dropped
 * mid-sentence means rewinding by hand before you can follow it, every time.
 *
 * Every dedicated podcast and audiobook player rewinds a little on resume for this reason. The
 * amount is small deliberately: enough to recover the sentence you were in, not enough to make you
 * listen to a minute you have already heard.
 *
 * Music is excluded. A three minute track resumed four seconds early is just a track starting
 * oddly, and the research is clear that restoring an exact position in music is the less useful
 * behaviour anyway.
 */
import type { MediaPillar } from './mediaPillar';

/** Below this you have not been away; you paused to do something and came back. */
export const SHORT_GAP_MS = 60_000;
/**
 * An hour away is a different kind of absence from a minute.
 *
 * You did something else entirely — a meal, a commute, a meeting — and the sentence you were in
 * is gone even though the chapter is still roughly in mind. A few seconds no longer recovers it.
 */
export const HOUR_GAP_MS = 60 * 60 * 1000;
/** Beyond this the context is gone, not merely faded, and the longest rewind applies. */
export const LONG_GAP_MS = 24 * 60 * 60 * 1000;

export interface RewindPolicy {
  /** Seconds to rewind after a short absence. */
  brief: number;
  /** Seconds after an hour or more, where the sentence is gone but the thread is not. */
  hour: number;
  /** Seconds after a day or more, where you are re-entering rather than continuing. */
  extended: number;
}

/*
 * An audiobook rewinds further than a podcast at every level. Losing your place in a thirty hour
 * novel costs more than losing it in a news episode, and narrative prose needs more run-up to
 * re-enter than two people talking does.
 */
const POLICY: Record<MediaPillar, RewindPolicy | null> = {
  music: null,
  podcast: { brief: 3, hour: 10, extended: 30 },
  audiobook: { brief: 10, hour: 15, extended: 60 },
  // Spoken text rewinds in characters rather than seconds; see narrationPosition.ts.
  'spoken-text': null,
};

export function rewindPolicyFor(pillar: MediaPillar): RewindPolicy | null {
  return POLICY[pillar];
}

/**
 * How far back to go, given how long you were away.
 *
 * Returns 0 rather than null for the pillars that do not rewind, so callers can subtract
 * unconditionally instead of branching.
 */
export function rewindSecondsFor(pillar: MediaPillar, awayMs: number): number {
  const policy = POLICY[pillar];
  if (!policy) return 0;
  if (!Number.isFinite(awayMs) || awayMs < SHORT_GAP_MS) return 0;
  if (awayMs >= LONG_GAP_MS) return policy.extended;
  return awayMs >= HOUR_GAP_MS ? policy.hour : policy.brief;
}

/**
 * The position to resume at.
 *
 * Never rewinds past the start, and never rewinds a position that is already at the beginning —
 * an episode you barely started should not resume at a negative offset or claim you were four
 * seconds in when you were not.
 */
export function resumeAtSeconds(
  savedSeconds: number,
  savedAt: number | undefined,
  pillar: MediaPillar,
  now: number = Date.now(),
): number {
  if (!Number.isFinite(savedSeconds) || savedSeconds <= 0) return 0;
  // No timestamp means a position saved before this existed. Honour it exactly rather than
  // guessing at an age, which would rewind every old position on first launch.
  if (savedAt === undefined || !Number.isFinite(savedAt)) return savedSeconds;
  const rewind = rewindSecondsFor(pillar, now - savedAt);
  return Math.max(0, savedSeconds - rewind);
}
