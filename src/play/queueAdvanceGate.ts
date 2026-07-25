/** Minimum listened seconds before honoring an end-of-track advance (anti-spurious-ended). */
export const QUEUE_ADVANCE_MIN_PLAYED_SECONDS = 2;

/**
 * Minimum real wall-clock time the "reached playing" signal must have held before it alone can
 * authorize an advance. `reachedPlaying` is a boolean with no time dimension — without this, a
 * track that flickers into Playing (or is force-marked so by an in-place/gapless transition) and
 * then immediately reports "ended" (a bad transition, corrupted content, or a native queueEnded
 * event) gets waved through with zero verified playback, which can cascade into rapid-fire
 * track skipping. This does not replace the peak-seconds check below — it just stops
 * `reachedPlaying` from being an unconditional bypass of it.
 */
export const QUEUE_ADVANCE_MIN_REACHED_PLAYING_MS = 400;

export type QueueAdvancePlaybackProof = {
  reachedPlaying: boolean;
  peakSeconds: number;
  currentSeconds: number;
  minSeconds?: number;
  /**
   * Ms since reachedPlaying's false->true edge, or undefined if the caller doesn't track it
   * (treated as trusted, preserving old behavior for callers that only pass the boolean).
   */
  msSinceReachedPlaying?: number;
  minReachedPlayingMs?: number;
};

/**
 * True when the current track actually played long enough to treat an ended event as real.
 * Native Exo on OnePlus often reaches audible playback before JS FSM reports Playing.
 */
export function trackPlaybackMatureForAdvance(input: QueueAdvancePlaybackProof): boolean {
  if (input.reachedPlaying) {
    const minMs = input.minReachedPlayingMs ?? QUEUE_ADVANCE_MIN_REACHED_PLAYING_MS;
    if (input.msSinceReachedPlaying === undefined || input.msSinceReachedPlaying >= minMs) {
      return true;
    }
  }
  const min = input.minSeconds ?? QUEUE_ADVANCE_MIN_PLAYED_SECONDS;
  const peak = Math.max(input.peakSeconds, input.currentSeconds);
  return peak >= min;
}

export type NativeGaplessDuplicateAdvanceInput = {
  seamless: boolean;
  gaplessTransitionAtMs: number;
  suppressWindowMs?: number;
  endedEnvelopeId: string | undefined;
  queueIndex: number;
  playQueue: { envelopeId: string }[];
};

/**
 * Skip JS queue advance when native Exo already gapless-advanced past the ended track.
 * Do NOT suppress when the queue index still points at the ended track (native exhausted).
 */
export function shouldSuppressJsAdvanceAfterNativeGapless(
  input: NativeGaplessDuplicateAdvanceInput,
): boolean {
  if (!input.seamless) return false;
  const windowMs = input.suppressWindowMs ?? 4000;
  if (Date.now() - input.gaplessTransitionAtMs >= windowMs) return false;
  if (!input.endedEnvelopeId || input.playQueue.length <= 1) return false;
  const endedIdx = input.playQueue.findIndex((t) => t.envelopeId === input.endedEnvelopeId);
  if (endedIdx < 0) return false;
  return input.queueIndex > endedIdx;
}

export type ResolveActivePlayQueueInput = {
  envEnvelopeId: string;
  refQueue: { envelopeId: string }[];
  stateQueue: { envelopeId: string }[];
  queueSeed?: { queue: { envelopeId: string }[] } | null;
  preservePlayQueue?: boolean;
};

/**
 * Pick the queue backing an album/skip/advance play without collapsing multi-track
 * albums when React state lags behind playQueueRef (same length, stale entries).
 */
export function resolveActivePlayQueue(input: ResolveActivePlayQueueInput): {
  queue: { envelopeId: string }[];
  collapsed: boolean;
} {
  const { envEnvelopeId, refQueue, stateQueue, queueSeed, preservePlayQueue } = input;
  const tappedInRefQueue = refQueue.some((e) => e.envelopeId === envEnvelopeId);
  const tappedInStateQueue = stateQueue.some((e) => e.envelopeId === envEnvelopeId);

  if (queueSeed?.queue) {
    return { queue: queueSeed.queue, collapsed: false };
  }
  if (tappedInRefQueue) {
    return { queue: refQueue, collapsed: false };
  }
  if (tappedInStateQueue) {
    return { queue: stateQueue, collapsed: false };
  }
  if (
    preservePlayQueue &&
    refQueue.length > 1 &&
    refQueue.some((e) => e.envelopeId === envEnvelopeId)
  ) {
    return { queue: refQueue, collapsed: false };
  }
  return { queue: [{ envelopeId: envEnvelopeId }], collapsed: true };
}
