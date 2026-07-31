/**
 * Compression and EQ tunings for spoken word.
 *
 * Narration has a dynamic range music does not. A reader drops to a whisper for a line of interior
 * monologue and then shouts the next one, and on a bus or a train the whisper falls under the
 * ambient noise floor. The listener turns it up, and the shout arrives at the raised volume. No
 * amount of volume solves this, because the problem is the distance between the two — which is
 * what a compressor closes.
 *
 * Audiobooks need more of that than podcasts do. Two people talking into microphones in a room sit
 * in a fairly narrow band already; a performed audiobook is deliberately dramatic, so it gets a
 * lower threshold, a firmer ratio and a slower release. The podcast numbers here are the ones that
 * were already tuned and shipping — they are restated, not changed.
 */

import type { SonicOutputRoute } from './sandboxSonic';

// Deliberately literal rather than imported from audiobookPlayback: this module is pulled in by
// the playback router, and importing that file closes a cycle back through it that leaves these
// profiles undefined at module-init time. speechClarity.test.ts asserts the two stay equal.
const AUDIOBOOK_ID_PREFIX = 'audiobook:';
const PODCAST_ID_PREFIX = 'podcast:';

export interface SpeechClarityProfile {
  id: 'podcast' | 'audiobook';
  /** Rumble and handling noise below the voice. */
  highPassHz: number;
  /** Consonant articulation lives here — lifting it is what makes speech easier to follow. */
  presenceHz: number;
  presenceGainDb: number;
  presenceQ: number;
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  /** Static gain after compression, in dB. See {@link theoreticalGainReductionDb}. */
  makeupGainDb: number;
}

/** Unchanged from the tuning that already ships for podcasts. */
export const PODCAST_CLARITY: SpeechClarityProfile = {
  id: 'podcast',
  highPassHz: 85,
  presenceHz: 2800,
  presenceGainDb: 3.2,
  presenceQ: 1.1,
  thresholdDb: -22,
  kneeDb: 8,
  ratio: 2.2,
  attackSec: 0.006,
  releaseSec: 0.14,
  makeupGainDb: 1.44,
};

export const AUDIOBOOK_CLARITY: SpeechClarityProfile = {
  id: 'audiobook',
  // 90 Hz sits just under a low male fundamental (~85 Hz), so it takes the room rumble and the
  // reader's chair without hollowing out the voice itself.
  highPassHz: 90,
  presenceHz: 3000,
  presenceGainDb: 3.5,
  presenceQ: 1.0,
  // Low enough to catch conversational narration rather than only the shouts.
  thresholdDb: -24,
  // A wide soft knee: the compressor eases in instead of switching on, which on a continuous voice
  // is the difference between "steady" and "audibly pumping".
  kneeDb: 10,
  ratio: 3,
  // Fast enough to catch a plosive or a sudden raised line before it gets through.
  attackSec: 0.005,
  // Slow enough that it does not recover between words and breathe on every syllable.
  releaseSec: 0.25,
  // Full makeup would be ~16 dB (see theoreticalGainReductionDb) which would leave audiobooks
  // dramatically louder than every other station and eat the ear-safety headroom. A quarter of it
  // lifts the whispered passages clear of a noisy carriage while leaving the perceived level
  // roughly where the rest of the app sits.
  makeupGainDb: 4,
};

/**
 * Gain reduction the compressor applies to a signal that arrives at 0 dBFS, in dB.
 *
 * This is what "full makeup" would have to restore, and the number that shows why restoring it
 * fully is the wrong move: at the audiobook settings it is 16 dB.
 */
export function theoreticalGainReductionDb(profile: SpeechClarityProfile): number {
  return -profile.thresholdDb * (1 - 1 / profile.ratio);
}

/** Fraction of the theoretical reduction a profile actually gives back. */
export function makeupFraction(profile: SpeechClarityProfile): number {
  const full = theoreticalGainReductionDb(profile);
  return full > 0 ? profile.makeupGainDb / full : 0;
}

export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/**
 * High-pass corner for a profile on a given output.
 *
 * A phone speaker cannot move enough air to reproduce anything much below 200 Hz; feeding it that
 * energy buys distortion, excursion and battery drain, and it muddies the voice sitting on top.
 * Cutting there frees amplifier headroom for the part of the signal that carries the words.
 *
 * On anything with real low-end — headphones, line out, a desk speaker — that same 200 Hz corner
 * would audibly thin a male narrator, so only the profile's own gentle rumble filter applies.
 */
export function highPassHzForRoute(
  profile: SpeechClarityProfile,
  route: SonicOutputRoute | null | undefined,
): number {
  if (route === 'phone-speaker') return Math.max(profile.highPassHz, 200);
  return profile.highPassHz;
}

/** The profile a given envelope should play through, or null when it is not spoken word. */
export function speechClarityProfileFor(
  envelopeId: string | null | undefined,
): SpeechClarityProfile | null {
  const id = envelopeId?.trim() ?? '';
  if (!id) return null;
  if (id.startsWith(AUDIOBOOK_ID_PREFIX)) return AUDIOBOOK_CLARITY;
  if (id.startsWith(PODCAST_ID_PREFIX)) return PODCAST_CLARITY;
  return null;
}
