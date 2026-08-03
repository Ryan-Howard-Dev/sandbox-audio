/**
 * Back and forward are not the same distance, because they are not the same request.
 *
 * Both buttons currently jump by one configured number, which reads as symmetry and is really an
 * accident of having only one setting. The two presses mean different things:
 *
 *   Forward is skipping something known and unwanted — a sponsor read, a title sequence, the
 *   thirty seconds of theme music at the top of every episode. It wants to cover ground.
 *
 *   Back is recovering something missed — a name, a clause, the sentence that went past while
 *   somebody spoke to you. It wants to land just before the thing you lost. Thirty seconds back
 *   overshoots into a minute you already heard and understood, so you sit through it annoyed,
 *   which is why the apps people actually use for books settle around ten to fifteen.
 *
 * So forward stays on the configured interval and back gets its own, shorter one. The setting the
 * user already chose keeps its meaning — it is the forward jump, the one that number was always
 * really about — and back is derived from it rather than being a second thing to configure.
 */
import type { MediaPillar } from './mediaPillar';

export interface SeekIntervals {
  /** Seconds a back press moves. */
  back: number;
  /** Seconds a forward press moves. */
  forward: number;
}

/**
 * The back jump for a given forward jump.
 *
 * Roughly half, then held inside ten to twenty seconds. The floor is there because a jump shorter
 * than about ten seconds does not clear the moment you were distracted in; the ceiling because
 * past twenty you are re-listening rather than recovering. Someone who has set forward to sixty
 * wants long forward jumps, not a half-minute of repetition every time they miss a word.
 */
export function backIntervalFor(forwardSeconds: number): number {
  const forward = Number.isFinite(forwardSeconds) && forwardSeconds > 0 ? forwardSeconds : 30;
  return Math.round(Math.max(10, Math.min(20, forward / 2)));
}

/**
 * What the two buttons should move, for what is playing.
 *
 * Music is not in the table on purpose: its buttons change track, and this file has nothing to say
 * about that. Callers should not reach here for music at all, but returning a symmetric pair
 * rather than throwing means a caller that does gets ordinary behaviour instead of a crash on the
 * transport bar.
 */
export function seekIntervalsFor(
  pillar: MediaPillar,
  configuredForwardSeconds: number,
): SeekIntervals {
  const forward =
    Number.isFinite(configuredForwardSeconds) && configuredForwardSeconds > 0
      ? Math.round(configuredForwardSeconds)
      : 30;
  if (pillar === 'music') return { back: forward, forward };
  return { back: backIntervalFor(forward), forward };
}

/**
 * Where a jump lands.
 *
 * Clamped at both ends. Past the end matters more than it sounds: seeking beyond the duration on
 * some Android decoders ends the item rather than parking at its last second, so a forward press
 * near the end of a chapter would silently start the next one.
 */
export function seekTargetSeconds(input: {
  currentSeconds: number;
  deltaSeconds: number;
  /** Zero or less where the length is not yet known, in which case only the floor applies. */
  durationSeconds: number;
}): number {
  const current = Number.isFinite(input.currentSeconds) ? input.currentSeconds : 0;
  const next = Math.max(0, current + input.deltaSeconds);
  return input.durationSeconds > 0 ? Math.min(next, input.durationSeconds) : next;
}
