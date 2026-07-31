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

/**
 * Media3 MEDIA_ITEM_TRANSITION_REASON_*. Only AUTO means "the previous item finished and playback
 * moved on" — the one case where native, not JS, is the authority on the queue position.
 */
export const EXO_TRANSITION_REASON_REPEAT = 0;
export const EXO_TRANSITION_REASON_AUTO = 1;
export const EXO_TRANSITION_REASON_SEEK = 2;
export const EXO_TRANSITION_REASON_PLAYLIST_CHANGED = 3;

export type NativeExoTransitionAuthorityInput = {
  /** Envelope the native transition resolved to. */
  transitionEnvelopeId: string;
  /** Envelope JS currently believes is playing. */
  activeEnvelopeId?: string;
  /** Envelope JS last navigated to itself (skip, tap, advance), if any. */
  pendingJsNavEnvelopeId?: string;
  /** When that navigation was issued. */
  pendingJsNavAtMs?: number;
  /** Media3's reason for the transition, when native reported one. */
  reason?: number;
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
 *
 * Ownership covers *every* transition in the window, not only the one matching the navigation
 * target. That is the R-018 fix, and the earlier narrower rule is why the bug survived this gate:
 * a skip calls playUrl with resetQueue, then the prefetch effect immediately enqueues the next
 * five tracks (PREFETCH_AHEAD = 5), and each of those produced a transition whose envelope was
 * *not* the navigation target — so each was adopted and each re-drove setQueueIndex. That is
 * exactly the observed overshoot of five to seven, against a native queue of about six.
 *
 * Nothing is lost by widening it. In that window JS has just reset the native queue and is
 * re-priming it, so every transition is an artifact of the re-prime rather than a listener moving
 * through a book, and a real gapless advance cannot occur three seconds into a track that is
 * minutes long.
 *
 * The reason check is what actually closes R-018, and the window is now only a backstop. Device
 * traces of every spurious transition showed reason=3 (PLAYLIST_CHANGED): a skip re-primes the
 * native queue, and rebuilding it emits transitions pointing at items *ahead* of the target. The
 * timer alone could not separate those from a real advance — one was measured arriving 2133ms
 * after the navigation, so a slower decode or a cache miss pushes it past the window and it gets
 * adopted, which is the observed jump of one to two tracks. A queue rebuild is never evidence that
 * a listener moved, whenever it lands, so only AUTO is treated as native's call to make.
 */
export function shouldAdoptNativeExoTransition(
  input: NativeExoTransitionAuthorityInput,
): boolean {
  const target = input.transitionEnvelopeId?.trim();
  if (!target) return false;
  if (target === input.activeEnvelopeId) return false;

  if (
    input.reason === EXO_TRANSITION_REASON_PLAYLIST_CHANGED ||
    input.reason === EXO_TRANSITION_REASON_SEEK
  ) {
    return false;
  }

  if (input.pendingJsNavEnvelopeId?.trim()) {
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
