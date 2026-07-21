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

/** Keep a loaded <img> src when locker vault mints a new blob for the same scope. */
export function stabilizePlaybackArtSrc(
  prev: string | undefined,
  next: string | undefined,
  scopeKey: string | undefined,
): string {
  const trimmedPrev = prev?.trim() ?? '';
  const trimmedNext = next?.trim() ?? '';
  const scope = scopeKey?.trim() ?? '';

  if (!trimmedNext) {
    if (trimmedPrev && scope) return trimmedPrev;
    return '';
  }
  if (!trimmedPrev || trimmedPrev === trimmedNext) return trimmedNext;
  if (!scope) return trimmedNext;

  const prevCanon = canonicalArtworkSrc(trimmedPrev);
  const nextCanon = canonicalArtworkSrc(trimmedNext);
  if (prevCanon && nextCanon && prevCanon === nextCanon) return trimmedPrev;

  if (trimmedPrev.startsWith('blob:') && trimmedNext.startsWith('blob:')) {
    return trimmedPrev;
  }
  return trimmedNext;
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

  for (const url of candidates) {
    const canon = canonicalArtworkSrc(url) ?? url;
    const safe = coalesceArtworkUrl(canon);
    if (safe) {
      const resolved = proxiedArtworkUrl(safe) ?? safe;
      return stabilizeResolvedPlaybackArt(playbackArtStabilizeScope(envelope), resolved);
    }
  }
  return '';
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
