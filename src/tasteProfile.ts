/**
 * Taste profile — derived listening affinity aggregates (local-only).
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import { meaningfulListenScore } from './listeningAnalytics';
import { getFollowedArtists, FOLLOWED_ARTISTS_CHANGE_EVENT } from './followedArtists';
import {
  getAllPlayEvents,
  PLAY_HISTORY_CHANGE_EVENT,
  type PlayEvent,
} from './playHistory';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope } from './sandboxLayer1';

const TASTE_PROFILE_KEY = 'sandbox_taste_profile_v1';
const PLAYLISTS_STORAGE_KEY = 'sandbox_layer4_playlists';

export const TASTE_PROFILE_SCHEMA_VERSION = 1;

export type TasteFeedbackKind = 'like' | 'dislike';

export type TasteProfileV1 = {
  schemaVersion: 1;
  trackAffinity: Record<string, number>;
  artistAffinity: Record<string, number>;
  albumAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  explicitFeedback: Record<string, TasteFeedbackKind>;
  updatedAt: number;
};

const FOLLOWED_ARTIST_BOOST = 3;
const PLAYLIST_TRACK_BOOST = 2;
const SKIP_PENALTY = -1.5;
const EARLY_SKIP_EXTRA_PENALTY = -1;
const EARLY_SKIP_PCT = 15;
export const EXPLICIT_LIKE_BOOST = 5;
export const EXPLICIT_DISLIKE_PENALTY = -5;

let cachedProfile: TasteProfileV1 | null = null;
let listenersInitialized = false;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
const REBUILD_DEBOUNCE_MS = 400;

function emptyProfile(): TasteProfileV1 {
  return {
    schemaVersion: 1,
    trackAffinity: {},
    artistAffinity: {},
    albumAffinity: {},
    genreAffinity: {},
    explicitFeedback: {},
    updatedAt: Date.now(),
  };
}

export function artistAffinityKey(artist: string): string {
  return normalizeIdentityKey(artist?.trim() || 'unknown artist');
}

/** Artist with no meaningful play-history affinity — discovery "new" slot. */
export function isNewArtistTrack(env: MediaEnvelope, profile: TasteProfileV1): boolean {
  const artistKey = artistAffinityKey(env.artist ?? '');
  const artistAff = profile.artistAffinity[artistKey] ?? 0;
  const trackAff = profile.trackAffinity[env.envelopeId?.trim() ?? ''] ?? 0;
  return artistAff <= 0 && trackAff <= 0;
}

export function albumAffinityKey(artist: string, album?: string): string {
  const ar = normalizeIdentityKey(artist?.trim() || 'unknown artist');
  const alb = normalizeIdentityKey(album?.trim() || 'unknown album');
  return `${ar}::${alb}`;
}

function readProfile(): TasteProfileV1 {
  const raw = prefsGetItem(TASTE_PROFILE_KEY);
  if (!raw) return emptyProfile();
  try {
    const parsed = JSON.parse(raw) as Partial<TasteProfileV1>;
    if (!parsed || parsed.schemaVersion !== 1) return emptyProfile();
    return {
      schemaVersion: 1,
      trackAffinity: parsed.trackAffinity ?? {},
      artistAffinity: parsed.artistAffinity ?? {},
      albumAffinity: parsed.albumAffinity ?? {},
      genreAffinity: parsed.genreAffinity ?? {},
      explicitFeedback: parsed.explicitFeedback ?? {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return emptyProfile();
  }
}

function writeProfile(profile: TasteProfileV1): void {
  cachedProfile = profile;
  prefsSetItem(TASTE_PROFILE_KEY, JSON.stringify(profile));
}

function addToMap(map: Record<string, number>, key: string, delta: number): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + delta;
}

type PlaylistRow = {
  type?: string;
  rules?: unknown;
  builtInId?: string;
  tracks?: { envelopeId?: string; artist?: string; album?: string; genre?: string }[];
};

function collectManualPlaylistEnvelopeIds(): Set<string> {
  const ids = new Set<string>();
  const raw = prefsGetItem(PLAYLISTS_STORAGE_KEY);
  if (!raw) return ids;
  try {
    const parsed = JSON.parse(raw) as PlaylistRow[];
    if (!Array.isArray(parsed)) return ids;
    for (const pl of parsed) {
      if (pl.type === 'smart' || pl.rules || pl.builtInId) continue;
      for (const track of pl.tracks ?? []) {
        const id = track.envelopeId?.trim();
        if (id) ids.add(id);
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}

function skipPenaltyWeight(event: PlayEvent): number {
  if (!event.skipped) return 0;
  let penalty = SKIP_PENALTY;
  if (event.completedPct < EARLY_SKIP_PCT) {
    penalty += EARLY_SKIP_EXTRA_PENALTY;
  }
  return penalty;
}

function resolveEnvelopeMetadata(
  envelopeId: string,
  events: PlayEvent[],
): { artist?: string; album?: string; genre?: string } {
  const event = events.find((e) => e.envelopeId === envelopeId);
  if (event) {
    return { artist: event.artist, album: event.album };
  }
  const raw = prefsGetItem(PLAYLISTS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PlaylistRow[];
    if (!Array.isArray(parsed)) return {};
    for (const pl of parsed) {
      const track = pl.tracks?.find((t) => t.envelopeId === envelopeId);
      if (track) {
        return { artist: track.artist, album: track.album, genre: track.genre };
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function applyExplicitFeedback(
  explicitFeedback: Record<string, TasteFeedbackKind>,
  trackAffinity: Record<string, number>,
  artistAffinity: Record<string, number>,
  albumAffinity: Record<string, number>,
  events: PlayEvent[],
): void {
  for (const [envelopeId, kind] of Object.entries(explicitFeedback)) {
    const boost = kind === 'like' ? EXPLICIT_LIKE_BOOST : EXPLICIT_DISLIKE_PENALTY;
    addToMap(trackAffinity, envelopeId, boost);
    const meta = resolveEnvelopeMetadata(envelopeId, events);
    if (meta.artist) {
      addToMap(artistAffinity, artistAffinityKey(meta.artist), boost);
    }
    if (meta.artist || meta.album) {
      addToMap(albumAffinity, albumAffinityKey(meta.artist ?? '', meta.album), boost);
    }
  }
}

export function rebuildTasteProfile(): TasteProfileV1 {
  const trackAffinity: Record<string, number> = {};
  const artistAffinity: Record<string, number> = {};
  const albumAffinity: Record<string, number> = {};
  const genreAffinity: Record<string, number> = {};

  const current = readProfile();
  const explicitFeedback = { ...current.explicitFeedback };
  const events = getAllPlayEvents();

  for (const event of events) {
    const trackId = event.envelopeId?.trim();
    if (!trackId) continue;
    const aKey = artistAffinityKey(event.artist);
    const albKey = albumAffinityKey(event.artist, event.album);

    if (event.skipped) {
      const penalty = skipPenaltyWeight(event);
      addToMap(trackAffinity, trackId, penalty);
      addToMap(artistAffinity, aKey, penalty);
    } else {
      const weight = meaningfulListenScore(event);
      addToMap(trackAffinity, trackId, weight);
      addToMap(artistAffinity, aKey, weight);
      addToMap(albumAffinity, albKey, weight);
    }
  }

  for (const followed of getFollowedArtists()) {
    addToMap(artistAffinity, artistAffinityKey(followed.name), FOLLOWED_ARTIST_BOOST);
  }

  for (const envelopeId of collectManualPlaylistEnvelopeIds()) {
    addToMap(trackAffinity, envelopeId, PLAYLIST_TRACK_BOOST);
  }

  applyExplicitFeedback(
    explicitFeedback,
    trackAffinity,
    artistAffinity,
    albumAffinity,
    events,
  );

  const profile: TasteProfileV1 = {
    schemaVersion: 1,
    trackAffinity,
    artistAffinity,
    albumAffinity,
    genreAffinity,
    explicitFeedback,
    updatedAt: Date.now(),
  };
  writeProfile(profile);
  return profile;
}

function scheduleRebuild(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildTasteProfile();
  }, REBUILD_DEBOUNCE_MS);
}

function initTasteProfileListeners(): void {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;
  window.addEventListener(PLAY_HISTORY_CHANGE_EVENT, scheduleRebuild);
  window.addEventListener(FOLLOWED_ARTISTS_CHANGE_EVENT, scheduleRebuild);
  window.addEventListener('sandbox-playlists-change', scheduleRebuild);
}

export function initTasteProfile(): void {
  initTasteProfileListeners();
  cachedProfile = readProfile();
  if (typeof window === 'undefined') {
    rebuildTasteProfile();
    return;
  }
  const deferRebuild = () => {
    try {
      rebuildTasteProfile();
    } catch (err) {
      console.warn('[Sandbox] taste profile rebuild failed:', err);
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(deferRebuild, { timeout: 8000 });
  } else {
    window.setTimeout(deferRebuild, 250);
  }
}

const ONBOARDING_GENRE_BOOST = 4;
const ONBOARDING_ARTIST_BOOST = 3;

/** Seed genre/artist affinity from first-run onboarding taste picks. */
export function applyOnboardingTasteSeeds(seeds: {
  genres: string[];
  artistsFreeText?: string;
}): void {
  const profile = readProfile();
  for (const genre of seeds.genres) {
    const key = normalizeIdentityKey(genre.trim());
    if (key) addToMap(profile.genreAffinity, key, ONBOARDING_GENRE_BOOST);
  }
  const artistsRaw = seeds.artistsFreeText?.trim();
  if (artistsRaw) {
    for (const artist of artistsRaw.split(/[,;]+/)) {
      const trimmed = artist.trim();
      if (!trimmed) continue;
      addToMap(profile.artistAffinity, artistAffinityKey(trimmed), ONBOARDING_ARTIST_BOOST);
    }
  }
  profile.updatedAt = Date.now();
  writeProfile(profile);
}

function ensureLoaded(): TasteProfileV1 {
  initTasteProfileListeners();
  if (!cachedProfile) {
    cachedProfile = readProfile();
  }
  return cachedProfile;
}

export function getTasteProfile(): TasteProfileV1 {
  return ensureLoaded();
}

export function getTrackAffinity(envelopeId: string): number {
  const id = envelopeId?.trim();
  if (!id) return 0;
  return getTasteProfile().trackAffinity[id] ?? 0;
}

export function getArtistAffinity(artist: string): number {
  return getTasteProfile().artistAffinity[artistAffinityKey(artist)] ?? 0;
}

export function getExplicitFeedback(envelopeId: string): TasteFeedbackKind | null {
  const id = envelopeId?.trim();
  if (!id) return null;
  return getTasteProfile().explicitFeedback[id] ?? null;
}

export function setExplicitFeedbackMap(
  explicitFeedback: Record<string, TasteFeedbackKind>,
): TasteProfileV1 {
  const profile = readProfile();
  const next: TasteProfileV1 = {
    ...profile,
    explicitFeedback: { ...explicitFeedback },
  };
  writeProfile(next);
  return rebuildTasteProfile();
}

export function scoreTrackForTaste(envelope: MediaEnvelope): number {
  const profile = getTasteProfile();
  const id = envelope.envelopeId?.trim();
  let score = 0;
  if (id) score += profile.trackAffinity[id] ?? 0;
  score += profile.artistAffinity[artistAffinityKey(envelope.artist ?? '')] ?? 0;
  if (envelope.album) {
    score += profile.albumAffinity[albumAffinityKey(envelope.artist ?? '', envelope.album)] ?? 0;
  }
  return score;
}

export type TasteRecipeWeightInput = {
  genreAffinity: Record<string, number>;
  artistAffinity: Record<string, number>;
};

/** Merge federated taste recipe weights into the local profile (no track IDs). */
export function mergeTasteRecipeWeights(
  weights: TasteRecipeWeightInput,
  strength = 0.5,
): TasteProfileV1 {
  const profile = readProfile();
  const scale = Math.max(0, Math.min(1, strength));

  for (const [genre, weight] of Object.entries(weights.genreAffinity ?? {})) {
    const key = normalizeIdentityKey(genre.trim());
    if (!key || !Number.isFinite(weight)) continue;
    addToMap(profile.genreAffinity, key, weight * scale);
  }

  for (const [artist, weight] of Object.entries(weights.artistAffinity ?? {})) {
    if (!artist.trim() || !Number.isFinite(weight)) continue;
    addToMap(profile.artistAffinity, artistAffinityKey(artist), weight * scale);
  }

  profile.updatedAt = Date.now();
  writeProfile(profile);
  return rebuildTasteProfile();
}

/** Smart playlist star rating: like=5, dislike=0, neutral from track affinity. */
export function getSmartPlaylistRating(envelopeId: string): number {
  const id = envelopeId?.trim();
  if (!id) return 0;
  const profile = getTasteProfile();
  const explicit = profile.explicitFeedback[id];
  if (explicit === 'like') return 5;
  if (explicit === 'dislike') return 0;
  const affinity = profile.trackAffinity[id] ?? 0;
  if (affinity <= 0) return 1;
  return Math.min(4, Math.max(2, Math.round(affinity)));
}
