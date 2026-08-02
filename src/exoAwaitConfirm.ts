/**
 * Deciding when to stop waiting for the native player to say what it loaded.
 *
 * After a track is handed to ExoPlayer the UI waits for the native side to confirm which envelope
 * it is actually playing, and until then it refuses to show a position. That wait exists for a good
 * reason: without it, the last track's position bleeds onto the new track's screen for a moment.
 *
 * The wait had no way out. It could only be released by the native side reporting an envelope id
 * equal to the one being waited for, and if it reported nothing — which it does — the wait never
 * ended. Every poll then pinned the clock back to zero for the entire track. The audio was
 * perfect; the timer sat at 0:00 and the scrubber never left the left edge, which reads as a
 * broken player within about two seconds of looking at it.
 *
 * Pulled out here because it is a decision, not plumbing, and a decision with three ways of being
 * wrong deserves a test rather than a device.
 */

export interface ExoAwaitInput {
  /** Envelope id the UI handed to the player and is waiting to hear back about. */
  awaitingEnvelopeId: string;
  /** What the native side says it is playing. Frequently absent, which is the whole problem. */
  nativeEnvelopeId?: string | null;
  /** Native playback state, so an outright failure can release the wait too. */
  state?: string;
  error?: unknown;
  /** Native position now, and at the previous poll, to tell playing apart from stalled. */
  positionSecs: number;
  previousPositionSecs: number;
  /** Milliseconds since the wait began. */
  waitedMs: number;
  timeoutMs: number;
}

export type ExoAwaitDecision =
  /** The player confirmed this track. */
  | 'confirmed'
  /** The player says nothing about identity but is plainly playing. Treat it as ours. */
  | 'assumed'
  /** Loading failed; there is nothing left to wait for. */
  | 'failed'
  /** Waited long enough, and audio is advancing. Stop pinning the clock to zero. */
  | 'timed-out'
  /** Still genuinely loading. Keep showing zero, because nothing is playing yet. */
  | 'waiting';

/**
 * Whether the position poll should trust what it is being told yet.
 *
 * Order matters. A positive confirmation beats everything; an error beats a timeout, because a
 * failed load should not spend two seconds pretending to buffer. The two lenient outcomes both
 * require the position to be moving, so a track that really is still loading keeps its zero rather
 * than showing a clock that runs before any sound.
 */
export function resolveExoAwait(input: ExoAwaitInput): ExoAwaitDecision {
  const nativeId = input.nativeEnvelopeId?.trim();
  if (nativeId && nativeId === input.awaitingEnvelopeId.trim()) return 'confirmed';
  if (input.state === 'error' || input.error) return 'failed';

  const advancing = input.positionSecs > 0 && input.positionSecs >= input.previousPositionSecs;

  /*
   * No id at all is not a mismatch. reconcileFromNativeExo has always read an absent id as ours
   * rather than as somebody else's, and the two paths disagreeing is what left this latched.
   */
  if (!nativeId && advancing) return 'assumed';

  // A different id that keeps playing anyway: give the confirmation a fair window, then believe
  // the audio over the label.
  if (input.waitedMs > input.timeoutMs && advancing && input.positionSecs > input.previousPositionSecs) {
    return 'timed-out';
  }

  return 'waiting';
}

/** True when the poll may show the native position rather than pinning it to zero. */
export function exoAwaitResolved(decision: ExoAwaitDecision): boolean {
  return decision !== 'waiting';
}
