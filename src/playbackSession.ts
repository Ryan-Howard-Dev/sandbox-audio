/**
 * Playback session — content-type guards and atomic now-playing display.
 * Spotify-style pattern: one envelopeId owns all visible metadata; never mix
 * parallel title/artwork state across content types or envelope switches.
 */

import type { AudioFsmState, MediaEnvelope } from './sandboxLayer1';
import { isPodcastEnvelopeId } from './podcastStorage';
import { resolveLockerEntryAlbumArt } from './playerBarTrackMeta';

export type PlaybackContentType = 'music' | 'podcast' | 'radio' | 'unknown';

export interface PlaybackDisplayFields {
  envelopeId: string;
  contentType: PlaybackContentType;
  title: string;
  artist: string;
  album?: string;
  artworkUrl: string;
  durationSeconds: number;
  positionSeconds: number;
}

export interface LockerFeaturedPreview {
  envelopeId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
}

export function playbackContentTypeFromEnvelopeId(
  envelopeId: string | null | undefined,
): PlaybackContentType {
  const id = envelopeId?.trim() ?? '';
  if (!id) return 'unknown';
  if (isPodcastEnvelopeId(id)) return 'podcast';
  if (id.startsWith('audiobook:')) return 'music';
  if (id.startsWith('radio-') || id.startsWith('mix-radio-')) return 'radio';
  return 'music';
}

export function contentTypesDiffer(
  envelopeIdA: string | null | undefined,
  envelopeIdB: string | null | undefined,
): boolean {
  const a = playbackContentTypeFromEnvelopeId(envelopeIdA);
  const b = playbackContentTypeFromEnvelopeId(envelopeIdB);
  return a !== b && a !== 'unknown' && b !== 'unknown';
}

/**
 * True when a new play tap must hard-stop native/web output before loading the next
 * envelope (no crossfade). Covers music↔podcast and podcast↔podcast; music→music
 * defers to crossfade prefs unless callers pass seamless gapless handoff.
 */
export function playbackSwitchRequiresHardPreempt(
  prevEnvelopeId: string | null | undefined,
  nextEnvelopeId: string | null | undefined,
): boolean {
  const prev = prevEnvelopeId?.trim() ?? '';
  const next = nextEnvelopeId?.trim() ?? '';
  if (!prev || !next || prev === next) return false;
  if (contentTypesDiffer(prev, next)) return true;
  if (isPodcastEnvelopeId(prev) || isPodcastEnvelopeId(next)) return true;
  return false;
}

export function emptyPlaybackDisplay(): PlaybackDisplayFields {
  return {
    envelopeId: '',
    contentType: 'unknown',
    title: '',
    artist: '',
    artworkUrl: '',
    durationSeconds: 0,
    positionSeconds: 0,
  };
}

/** Seed all display fields from one envelope — call synchronously on play tap. */
export function seedPlaybackDisplayFromEnvelope(
  env: MediaEnvelope,
  artworkOverride?: string,
): PlaybackDisplayFields {
  const envelopeId = env.envelopeId?.trim() ?? '';
  const artwork =
    artworkOverride?.trim() || env.artworkUrl?.trim() || '';
  return {
    envelopeId,
    contentType: playbackContentTypeFromEnvelopeId(envelopeId),
    title: env.title?.trim() ?? '',
    artist: env.artist?.trim() ?? '',
    album: env.album?.trim() || undefined,
    artworkUrl: artwork,
    durationSeconds: env.durationSeconds ?? 0,
    positionSeconds: 0,
  };
}

export function isPlaybackDisplayCurrent(
  display: PlaybackDisplayFields | null | undefined,
  activeEnvelopeId: string | null | undefined,
): boolean {
  const active = activeEnvelopeId?.trim() ?? '';
  if (!active) return !display?.envelopeId;
  return display?.envelopeId === active;
}

/**
 * Single source for now-playing UI — never mix title from one envelope with art
 * from another. Parallel artwork state is only honored when it matches envelopeId.
 */
export function resolveNowPlayingDisplay(input: {
  audioEnvelope: MediaEnvelope | null;
  audioTitle: string;
  audioArtist: string;
  audioState: AudioFsmState;
  displaySeed: PlaybackDisplayFields | null;
  parallelArtworkUrl: string;
  lockerFeatured?: LockerFeaturedPreview | null;
  currentTimeSeconds: number;
  hasActivePlayback: boolean;
}): PlaybackDisplayFields {
  const env = input.audioEnvelope;
  const envId = env?.envelopeId?.trim() ?? '';

  if (
    envId &&
    (input.hasActivePlayback ||
      input.audioState !== 'Idle' ||
      Boolean(env.url?.trim()))
  ) {
    const seedMatches = input.displaySeed?.envelopeId === envId;
    const seed = seedMatches ? input.displaySeed : null;
    const parallelArt = input.parallelArtworkUrl?.trim() || '';
    const lockerVaultArt = resolveLockerEntryAlbumArt(env) ?? '';
    const isLockerVault = env.provider === 'local-vault';
    // When display seed matches the active envelope, it owns metadata atomically.
    // Parallel artwork is only a fallback for progressive art load on the same envelope.
    // Locker playback prefers group-resolved vault art over per-track seed/envelope blobs.
    const artwork = seed
      ? isLockerVault
        ? lockerVaultArt ||
          seed.artworkUrl?.trim() ||
          env.artworkUrl?.trim() ||
          parallelArt ||
          ''
        : seed.artworkUrl?.trim() ||
          lockerVaultArt ||
          env.artworkUrl?.trim() ||
          (!seed.artworkUrl?.trim() ? parallelArt : '') ||
          ''
      : isLockerVault
        ? lockerVaultArt || env.artworkUrl?.trim() || ''
        : env.artworkUrl?.trim() || parallelArt || '';

    return {
      envelopeId: envId,
      contentType: playbackContentTypeFromEnvelopeId(envId),
      title:
        env.title?.trim() ||
        seed?.title ||
        input.audioTitle?.trim() ||
        '',
      artist:
        env.artist?.trim() ||
        seed?.artist ||
        input.audioArtist?.trim() ||
        '',
      album: env.album?.trim() || seed?.album,
      artworkUrl: artwork,
      durationSeconds: env.durationSeconds ?? seed?.durationSeconds ?? 0,
      positionSeconds: input.currentTimeSeconds,
    };
  }

  if (input.lockerFeatured && !input.hasActivePlayback) {
    return {
      envelopeId: input.lockerFeatured.envelopeId,
      contentType: 'music',
      title: input.lockerFeatured.title,
      artist: input.lockerFeatured.artist,
      album: input.lockerFeatured.album,
      artworkUrl: input.lockerFeatured.artworkUrl?.trim() ?? '',
      durationSeconds: input.lockerFeatured.durationSeconds ?? 0,
      positionSeconds: 0,
    };
  }

  return emptyPlaybackDisplay();
}

/** True when locker repair gates must not run (podcast / radio / device or catalog audiobook). */
export function shouldSkipLockerPlaybackGate(envelopeId: string): boolean {
  const kind = playbackContentTypeFromEnvelopeId(envelopeId);
  if (kind === 'podcast' || kind === 'radio') return true;
  const id = envelopeId.trim();
  return id.startsWith('audiobook:') || id.startsWith('audiobook-catalog:');
}

/**
 * Queue drawer "Now Playing" — prefer the audio FSM envelope when it diverges
 * from playQueue[queueIndex] (e.g. podcast tap without re-seeding music queue).
 */
export function resolveQueueNowPlaying(
  playQueue: MediaEnvelope[],
  queueIndex: number,
  activeEnvelope: MediaEnvelope | null,
  hasActivePlayback: boolean,
): MediaEnvelope | null {
  const queued = playQueue[queueIndex] ?? null;
  const activeId = activeEnvelope?.envelopeId?.trim() ?? '';

  if (!activeId || !hasActivePlayback) return queued;
  if (!queued || queued.envelopeId === activeId) return queued ?? activeEnvelope;
  return activeEnvelope;
}

/** Up Next list — avoid duplicating the resolved now-playing row. */
export function resolveQueueUpNext(
  playQueue: MediaEnvelope[],
  queueIndex: number,
  nowPlaying: MediaEnvelope | null,
): MediaEnvelope[] {
  const nowId = nowPlaying?.envelopeId?.trim() ?? '';
  const queuedAtIndex = playQueue[queueIndex] ?? null;

  if (queuedAtIndex && queuedAtIndex.envelopeId === nowId) {
    return playQueue.slice(queueIndex + 1);
  }

  if (!nowId) {
    return playQueue.slice(Math.max(0, queueIndex) + 1);
  }

  return playQueue.filter((e) => e.envelopeId !== nowId);
}
