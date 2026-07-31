/**
 * Which track the UI is allowed to say is playing.
 *
 * The screen used to paint the skip target the moment it was tapped, while ExoPlayer kept
 * decoding the previous stream for as long as the next one took to resolve — measured at ~5s on
 * this device, and ~15s before stream resolution got faster. For that whole window the title,
 * artist, artwork, duration, lock screen and notification all described a track nobody could
 * hear: the probe caught it as `UI: title=euphoria state=Resolving` against
 * `NATIVE: nativeTitle="HUMBLE."`. Identity is therefore withheld from a track until the stream
 * behind it is the one making sound, and the track that IS making sound keeps the screen until
 * then.
 *
 * Nothing here touches React or the audio layer — the decision is the part worth testing, and it
 * is a function of five observable facts.
 */

import type { AudioFsmState, MediaEnvelope } from './sandboxLayer1';
import type { PlaybackDisplayFields } from './playbackSession';

/** Whose metadata the caller must paint. */
export type NowPlayingAuthoritySource = 'live' | 'held' | 'none';

export type NowPlayingAuthorityReason =
  | 'nothing-loaded'
  | 'no-load-in-flight'
  | 'same-envelope'
  | 'nothing-audible-to-protect'
  | 'instant-handoff'
  | 'load-audible'
  | 'load-failed'
  | 'hold-timed-out'
  | 'awaiting-stream';

/**
 * States in which the loading envelope is provably not yet the source of sound. 'Idle' belongs
 * here because the Android poll reports idle mid-handoff while the old stream is still decoding —
 * treating that as "the new track is live" is the exact mistake this module exists to prevent.
 */
const NOT_YET_AUDIBLE: ReadonlySet<AudioFsmState> = new Set([
  'Resolving',
  'Connecting',
  'Idle',
]);

/**
 * How long the audible track may keep the screen while the next one resolves.
 *
 * Deliberately far below the 90s resolve watchdog in sandboxLayer3: a spinner that sits on the
 * previous track for a minute and a half is its own bug — the user is owed an answer about their
 * skip long before the resolve gives up on its own.
 */
export const NOW_PLAYING_HOLD_TIMEOUT_MS = 20_000;

export interface NowPlayingAuthorityInput {
  /** Envelope the audio layer is loading — the skip/tap target. */
  loadingEnvelopeId: string | null | undefined;
  /** Envelope last confirmed audible, snapshotted before the load replaced it. */
  heldEnvelopeId: string | null | undefined;
  /** False once the held stream is gone (stopped, cleared), so there is nothing to protect. */
  heldStillAudible: boolean;
  audioState: AudioFsmState;
  /** The load reused an already-playable stream, so there is no silent gap to cover. */
  startedInstantly: boolean;
  /** Time since the load began — only consulted while holding. */
  loadElapsedMs: number;
  /** Override for tests; defaults to NOW_PLAYING_HOLD_TIMEOUT_MS. */
  holdTimeoutMs?: number;
}

export interface NowPlayingAuthorityDecision {
  source: NowPlayingAuthoritySource;
  /** The envelope whose metadata may be shown. Empty when there is nothing to show. */
  envelopeId: string;
  /** Non-empty while a different track's stream is resolving behind held metadata. */
  resolvingEnvelopeId: string;
  /** Draw the resolving affordance ON the held track — the skip must still look registered. */
  showResolvingAffordance: boolean;
  /** The hold is over without the load ever becoming audible; the caller surfaces the failure. */
  abandonLoad: boolean;
  reason: NowPlayingAuthorityReason;
}

function decide(
  source: NowPlayingAuthoritySource,
  envelopeId: string,
  reason: NowPlayingAuthorityReason,
  extra?: Partial<NowPlayingAuthorityDecision>,
): NowPlayingAuthorityDecision {
  return {
    source,
    envelopeId,
    resolvingEnvelopeId: '',
    showResolvingAffordance: false,
    abandonLoad: false,
    reason,
    ...extra,
  };
}

export function resolveNowPlayingAuthority(
  input: NowPlayingAuthorityInput,
): NowPlayingAuthorityDecision {
  const loadingId = input.loadingEnvelopeId?.trim() ?? '';
  const heldId = input.heldEnvelopeId?.trim() ?? '';
  const canHold = Boolean(heldId) && input.heldStillAudible;
  const holdTimeoutMs = input.holdTimeoutMs ?? NOW_PLAYING_HOLD_TIMEOUT_MS;

  if (!loadingId) {
    if (canHold) return decide('held', heldId, 'no-load-in-flight');
    return decide('none', '', 'nothing-loaded');
  }

  // Same track reloading (URL repair, seamless quality swap) — its metadata is already on screen
  // and withholding it would blank a track that never stopped playing.
  if (loadingId === heldId) return decide('live', loadingId, 'same-envelope');

  if (!canHold) return decide('live', loadingId, 'nothing-audible-to-protect');

  // tryInstantPlayable hit: the stream was already playable, so the swap is simultaneous with the
  // sound. Delaying identity here would invent a gap the fast path exists to avoid.
  if (input.startedInstantly) return decide('live', loadingId, 'instant-handoff');

  if (input.audioState === 'Playing' || input.audioState === 'Ready') {
    return decide('live', loadingId, 'load-audible');
  }

  // The stream will never arrive. Falling back to the track still coming out of the speaker is the
  // only honest answer left; the caller pairs this with the resolve-failed toast.
  if (input.audioState === 'Failed') {
    return decide('held', heldId, 'load-failed', { abandonLoad: true });
  }

  if (NOT_YET_AUDIBLE.has(input.audioState)) {
    if (input.loadElapsedMs >= holdTimeoutMs) {
      return decide('held', heldId, 'hold-timed-out', { abandonLoad: true });
    }
    return decide('held', heldId, 'awaiting-stream', {
      resolvingEnvelopeId: loadingId,
      showResolvingAffordance: true,
    });
  }

  return decide('live', loadingId, 'load-audible');
}

/**
 * Position to show while holding.
 *
 * The two platforms disagree about what the clock means mid-handoff: the Android poll keeps
 * reporting the still-decoding held stream's advancing position, while the web element is torn
 * down and reads 0. Taking the larger keeps the progress bar moving where it truly is moving and
 * stops it snapping back to zero where it is not.
 */
export function resolveHeldPositionSeconds(
  heldPositionSeconds: number,
  livePositionSeconds: number,
): number {
  const held = Number.isFinite(heldPositionSeconds) ? heldPositionSeconds : 0;
  const live = Number.isFinite(livePositionSeconds) ? livePositionSeconds : 0;
  return Math.max(held > 0 ? held : 0, live > 0 ? live : 0);
}

/**
 * Whether a metadata commit that was in flight still describes the current intent.
 *
 * Five fast presses of next leave four resolutions racing behind the fifth. Any of them landing
 * would commit a track the user has already skipped past, which is the original bug wearing a
 * different hat — so a commit must match both the envelope and the play generation that asked
 * for it. Same guard as the queue/chapter cancellation checks elsewhere in the app.
 */
export function isNowPlayingCommitCurrent(
  commit: { envelopeId: string | null | undefined; playToken?: number },
  current: { envelopeId: string | null | undefined; playToken?: number },
): boolean {
  const committed = commit?.envelopeId?.trim() ?? '';
  const active = current?.envelopeId?.trim() ?? '';
  if (!committed || committed !== active) return false;
  if (commit.playToken == null || current.playToken == null) return true;
  return commit.playToken === current.playToken;
}

/**
 * True when the loading envelope has become the source of sound and may take over the screen.
 * Ready counts: the stream is attached and owns the output even when autoplay is held back.
 */
export function shouldCommitAudibleNowPlaying(
  audioState: AudioFsmState,
  loadingEnvelopeId: string | null | undefined,
): boolean {
  if (!loadingEnvelopeId?.trim()) return false;
  return audioState === 'Playing' || audioState === 'Ready';
}

/**
 * Snapshot of a track that was confirmed audible, kept so it can still be drawn after the audio
 * layer's own envelope has moved on to the next one.
 */
export interface HeldNowPlaying {
  envelopeId: string;
  display: PlaybackDisplayFields;
  /**
   * The audio layer has already moved on to the next envelope, so cover-art resolution (which
   * reads provider/sourceId off the envelope, not the display fields) needs this copy or it
   * resolves the resolving track's artwork behind the held track's title.
   */
  envelope: MediaEnvelope | null;
}

function sameDisplayedIdentity(
  a: PlaybackDisplayFields | null | undefined,
  b: PlaybackDisplayFields | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.envelopeId === b.envelopeId &&
    a.contentType === b.contentType &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.artworkUrl === b.artworkUrl &&
    a.durationSeconds === b.durationSeconds
  );
}

/**
 * Snapshot to keep for the audible track, returning `prev` untouched when nothing the screen shows
 * has changed.
 *
 * Position is excluded from the comparison and from the snapshot: it ticks every second, and a
 * fresh snapshot per tick would re-render the entire player — and every memo keyed off it — once a
 * second for the whole of playback.
 */
export function nextHeldNowPlaying(
  prev: HeldNowPlaying | null | undefined,
  next: {
    envelopeId: string;
    display: PlaybackDisplayFields;
    envelope: MediaEnvelope | null;
  },
): HeldNowPlaying {
  if (
    prev &&
    prev.envelopeId === next.envelopeId &&
    prev.envelope === next.envelope &&
    sameDisplayedIdentity(prev.display, next.display)
  ) {
    return prev;
  }
  return {
    envelopeId: next.envelopeId,
    display: next.display,
    envelope: next.envelope,
  };
}

/** The envelope downstream resolvers (cover art, locker lookups) must be pointed at. */
export function resolveAuthoritativeEnvelope(
  decision: NowPlayingAuthorityDecision,
  liveEnvelope: MediaEnvelope | null,
  held: HeldNowPlaying | null | undefined,
): MediaEnvelope | null {
  if (decision.source !== 'held') return liveEnvelope;
  return held?.envelope ?? liveEnvelope;
}

/** Final fields to paint, once the decision above has picked whose they are. */
export function applyNowPlayingAuthority(
  decision: NowPlayingAuthorityDecision,
  liveDisplay: PlaybackDisplayFields,
  held: HeldNowPlaying | null | undefined,
  position: { heldPositionSeconds: number; livePositionSeconds: number },
): PlaybackDisplayFields {
  if (decision.source !== 'held' || !held) return liveDisplay;
  return {
    ...held.display,
    positionSeconds: resolveHeldPositionSeconds(
      position?.heldPositionSeconds ?? 0,
      position?.livePositionSeconds ?? 0,
    ),
  };
}
