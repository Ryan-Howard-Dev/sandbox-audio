import {
  canonicalArtworkSrc,
  coalesceArtworkUrl,
  proxiedArtworkUrl,
} from './displaySanitize';
import {
  getLockerEntriesSnapshot,
  isPersistentAlbumArt,
  lockerAlbumGroupKey,
  resolveLockerEntryGroupArt,
} from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';

/** Session-stable playback art — survives locker blob URL churn during active playback. */
const sessionPlaybackArtByScope = new Map<string, string>();

/** Locker row id from envelope — tolerates local- prefix on sourceId or envelopeId. */
export function resolveLockerEntryId(
  envelope: Pick<MediaEnvelope, 'sourceId' | 'envelopeId'> | null | undefined,
): string | undefined {
  const fromSource = envelope?.sourceId?.trim().replace(/^local-/, '');
  if (fromSource) return fromSource;
  const fromEnv = envelope?.envelopeId?.replace(/^local-/, '').trim();
  return fromEnv || undefined;
}

/**
 * Stabilization scope for playback art — album group for locker tracks so skip
 * within the same album does not remint blob URLs and flash vinyl/poster.
 */
export function playbackArtStabilizeScope(
  envelope: MediaEnvelope | null | undefined,
): string | undefined {
  const envId = envelope?.envelopeId?.trim();
  if (!envId) return undefined;
  if (envelope?.provider === 'local-vault') {
    const entryId = resolveLockerEntryId(envelope);
    if (entryId) {
      const snap = getLockerEntriesSnapshot();
      const entry = snap?.find((e) => e.id === entryId);
      const albumKey = entry ? lockerAlbumGroupKey(entry) : null;
      if (albumKey) return `locker-album:${albumKey}`;
    }
  }
  return envId;
}

/**
 * Which scope each stabilised src was chosen for.
 *
 * `prev` is only ever "what is on screen right now", and right after a track change that is the
 * *previous* track's cover. Without this the function cannot tell a vault re-mint apart from a new
 * song, and the blob rule below would answer both with the old artwork.
 */
const scopeByArtSrc = new Map<string, string>();

/** Bounded so a long session cannot grow this without limit. */
const SCOPE_MEMORY_LIMIT = 64;

function rememberArtScope(src: string, scope: string): void {
  if (!src || !scope) return;
  if (scopeByArtSrc.size >= SCOPE_MEMORY_LIMIT) {
    const oldest = scopeByArtSrc.keys().next().value;
    if (oldest) scopeByArtSrc.delete(oldest);
  }
  scopeByArtSrc.set(src, scope);
}

/**
 * Whether `prev` was chosen for this same scope.
 *
 * Unrecorded art gets the benefit of the doubt — on a cold start there is no provenance to check,
 * and refusing to stabilise there would reintroduce the blob flicker this function exists to stop.
 * Only art known to belong to a *different* scope is treated as another track's.
 */
function artBelongsToScope(src: string, scope: string): boolean {
  if (!src || !scope) return false;
  const known = scopeByArtSrc.get(src);
  return known === undefined || known === scope;
}

/**
 * Keep a loaded <img> src when the locker vault mints a new blob for the same scope.
 *
 * The point is narrow: locker artwork lives behind object URLs that are revoked and re-created,
 * so the same cover can arrive under a new blob: address and would otherwise flicker. Holding the
 * old src across that is right.
 *
 * Holding it across a *track change* is not, and that is what happened — the blob rule returned
 * the previous src whenever both sides were blobs, without checking they described the same thing,
 * so starting a new song left the last song's cover on screen. Every rule that prefers `prev` now
 * requires `prev` to be the src this same scope produced.
 */
export function stabilizePlaybackArtSrc(
  prev: string | undefined,
  next: string | undefined,
  scopeKey: string | undefined,
): string {
  const trimmedPrev = prev?.trim() ?? '';
  const trimmedNext = next?.trim() ?? '';
  const scope = scopeKey?.trim() ?? '';
  const prevBelongsToScope = artBelongsToScope(trimmedPrev, scope);

  const remember = (value: string): string => {
    rememberArtScope(value, scope);
    return value;
  };

  if (!trimmedNext) {
    // Artwork not resolved yet. Holding the last frame is right here — it is a gap, not a change,
    // and the scope check belongs on the blob rule below, which is what actually kept the wrong
    // cover on screen after a track change.
    if (trimmedPrev && scope) return trimmedPrev;
    return '';
  }
  if (!trimmedPrev || trimmedPrev === trimmedNext) return remember(trimmedNext);
  if (!scope) return trimmedNext;

  // Same picture under a different address — safe whoever it belonged to.
  const prevCanon = canonicalArtworkSrc(trimmedPrev);
  const nextCanon = canonicalArtworkSrc(trimmedNext);
  if (prevCanon && nextCanon && prevCanon === nextCanon) return remember(trimmedPrev);

  if (prevBelongsToScope && trimmedPrev.startsWith('blob:') && trimmedNext.startsWith('blob:')) {
    return trimmedPrev;
  }
  return remember(trimmedNext);
}

function stabilizeResolvedPlaybackArt(
  scopeKey: string | undefined,
  candidate: string,
): string {
  const scope = scopeKey?.trim() ?? '';
  if (!candidate) {
    if (!scope) return '';
    return sessionPlaybackArtByScope.get(scope) ?? '';
  }
  if (!scope) return candidate;

  const prev = sessionPlaybackArtByScope.get(scope);
  if (!prev) {
    sessionPlaybackArtByScope.set(scope, candidate);
    return candidate;
  }
  if (prev === candidate) return prev;

  const prevCanon = canonicalArtworkSrc(prev);
  const nextCanon = canonicalArtworkSrc(candidate);
  if (prevCanon && nextCanon && prevCanon === nextCanon) return prev;

  if (isPersistentAlbumArt(candidate) && !isPersistentAlbumArt(prev)) {
    sessionPlaybackArtByScope.set(scope, candidate);
    return candidate;
  }
  // Once a scope has a stable persistent cover, LOCK it — never switch to any
  // other URL for the same track/album. The resolver otherwise alternates between
  // sources (locker blob: vs envelope data:/http, or two different data: URIs)
  // across renders, and that flip-flop is what made the player art flicker.
  if (isPersistentAlbumArt(prev)) return prev;
  if (prev.startsWith('blob:') && candidate.startsWith('blob:')) return prev;

  sessionPlaybackArtByScope.set(scope, candidate);
  return candidate;
}

export type PlayerBarAudioSlice = {
  title: string;
  artist: string;
  state: string;
  envelope: MediaEnvelope | null;
};

export type PlayerBarRemoteTrack = {
  title: string;
  artist: string;
  album?: string;
};

export function resolvePlayerBarHasTrack(
  connectRemote: boolean,
  remoteTrackId: string | null | undefined,
  audio: PlayerBarAudioSlice,
): boolean {
  if (connectRemote) return Boolean(remoteTrackId);
  return (
    Boolean(audio.envelope) ||
    audio.state === 'Playing' ||
    audio.state === 'Ready' ||
    audio.state === 'Resolving' ||
    audio.state === 'Connecting' ||
    audio.state === 'Failed'
  );
}

export function resolvePlayerBarArtwork(
  parallelArtworkUrl: string,
  displaySeedEnvelopeId: string | null | undefined,
  activeEnvelopeId: string | null | undefined,
  envelopeArtworkUrl: string | null | undefined,
): string {
  const parallel = parallelArtworkUrl?.trim() ?? '';
  const seedId = displaySeedEnvelopeId?.trim() ?? '';
  const activeId = activeEnvelopeId?.trim() ?? '';
  if (parallel && seedId && activeId && seedId === activeId) return parallel;
  return envelopeArtworkUrl?.trim() || parallel || '';
}

/** Locker row cover — same resolver chain as LocalView album header / track thumbs. */
export function resolveLockerEntryAlbumArt(
  envelope: MediaEnvelope | null | undefined,
): string | undefined {
  if (envelope?.provider !== 'local-vault') {
    return undefined;
  }
  const id = resolveLockerEntryId(envelope);
  if (!id) return undefined;
  const snap = getLockerEntriesSnapshot();
  const entry = snap?.find((e) => e.id === id);
  if (!entry) return undefined;

  return resolveLockerEntryGroupArt(entry, snap);
}

/**
 * Now playing + mini player cover — mirror library art resolution.
 * Locker playback prefers vault albumArt over stale parallel/seed URLs.
 */
export function resolvePlaybackCoverArt(
  parallelArtworkUrl: string | undefined,
  envelope: MediaEnvelope | null | undefined,
  lockerAlbumArt?: string | undefined,
): string {
  const locker = lockerAlbumArt ?? resolveLockerEntryAlbumArt(envelope);
  const isLocker = envelope?.provider === 'local-vault';
  const candidates = isLocker
    ? [locker, envelope?.artworkUrl, parallelArtworkUrl]
    : [parallelArtworkUrl, envelope?.artworkUrl, locker];

  const scope = playbackArtStabilizeScope(envelope);
  for (const url of candidates) {
    const canon = canonicalArtworkSrc(url) ?? url;
    const safe = coalesceArtworkUrl(canon);
    if (safe) {
      const resolved = proxiedArtworkUrl(safe) ?? safe;
      return stabilizeResolvedPlaybackArt(scope, resolved);
    }
  }
  // No safe candidate this render (locker re-minted its blob URLs mid-playback,
  // so every source is momentarily empty). Fall back to the locked cover for this
  // scope instead of returning '' — returning '' here is what blanked the art out
  // a second after it loaded.
  return stabilizeResolvedPlaybackArt(scope, '');
}

/** Retry cover after <img> error — skip the failed src, prefer locker vault art. */
export function resolvePlaybackCoverArtFallback(
  envelope: MediaEnvelope | null | undefined,
  failedSrc: string | undefined,
  parallelArtworkUrl?: string | undefined,
): string {
  const failedCanon = canonicalArtworkSrc(failedSrc);
  const locker = resolveLockerEntryAlbumArt(envelope);
  const isLocker = envelope?.provider === 'local-vault';
  const candidates = isLocker
    ? [locker, envelope?.artworkUrl, parallelArtworkUrl]
    : [parallelArtworkUrl, envelope?.artworkUrl, locker];

  for (const url of candidates) {
    const canon = canonicalArtworkSrc(url) ?? url;
    if (!canon || (failedCanon && canon === failedCanon)) continue;
    const safe = coalesceArtworkUrl(canon);
    if (safe) return proxiedArtworkUrl(safe) ?? safe;
  }
  return '';
}

export function resolvePlayerBarDisplay(
  connectRemote: boolean,
  track: PlayerBarRemoteTrack | null,
  audio: PlayerBarAudioSlice,
): { title: string; artist: string; album?: string } {
  if (connectRemote && track) {
    return {
      title: track.title,
      artist: track.artist,
      album: track.album,
    };
  }
  if (
    audio.envelope &&
    (audio.state === 'Resolving' ||
      audio.state === 'Connecting' ||
      audio.state === 'Playing' ||
      audio.state === 'Ready' ||
      audio.state === 'Failed')
  ) {
    return {
      title: audio.envelope.title || audio.title || '',
      artist: audio.envelope.artist || audio.artist || '',
      album: audio.envelope.album,
    };
  }
  return {
    title: audio.title || audio.envelope?.title || '',
    artist: audio.artist || audio.envelope?.artist || '',
    album: audio.envelope?.album,
  };
}
