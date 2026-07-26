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

/** How long a JS-initiated navigation owns the queue index against native echo transitions. */
export const JS_NAV_TRANSITION_OWNERSHIP_MS = 3000;

export type NativeExoTransitionAuthorityInput = {
  /** Envelope the native transition resolved to. */
  transitionEnvelopeId: string;
  /** Envelope JS currently believes is playing. */
  activeEnvelopeId?: string;
  /** Envelope JS last navigated to itself (skip, tap, advance), if any. */
  pendingJsNavEnvelopeId?: string;
  /** When that navigation was issued. */
  pendingJsNavAtMs?: number;
  nowMs?: number;
  ownershipWindowMs?: number;
};

/**
 * Whether a native mediaItemTransition should re-drive the JS queue index.
 *
 * Native fires a transition for *every* item change, including ones JS just caused. Adopting
 * those means calling setQueueIndex a second time on top of the JS advance, which is what made
 * the player visibly jump between tracks on skip. The active-track guard alone does not catch it:
 * the transition can arrive before the JS advance has updated the active envelope ref, so the
 * comparison is against the *previous* track and passes.
 *
 * So JS navigation claims ownership of the index for a short window, and native echoes inside it
 * are ignored. A genuine gapless advance — the case this handler exists for — has no pending JS
 * navigation and is still adopted. The window expires so a stale claim can never wedge the
 * handler shut.
 */
export function shouldAdoptNativeExoTransition(
  input: NativeExoTransitionAuthorityInput,
): boolean {
  const target = input.transitionEnvelopeId?.trim();
  if (!target) return false;
  if (target === input.activeEnvelopeId) return false;

  const pending = input.pendingJsNavEnvelopeId?.trim();
  if (pending && pending === target) {
    const windowMs = input.ownershipWindowMs ?? JS_NAV_TRANSITION_OWNERSHIP_MS;
    const elapsed = (input.nowMs ?? Date.now()) - (input.pendingJsNavAtMs ?? 0);
    if (elapsed >= 0 && elapsed < windowMs) return false;
  }
  return true;
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
