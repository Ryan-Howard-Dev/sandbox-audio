/**
 * Spotify-style playlist enhancement — suggest locker tracks matching playlist vibe.
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import type { MediaEnvelope } from './sandboxLayer1';
import { scoreAiPromptMatch } from './playlistAiPrompt';
import type { StoredPlaylist } from './playlistStorage';
import { isSmartPlaylist } from './playlistStorage';
import { getSonicFeaturesForEnvelope, sonicSimilarity } from './sonicFeatures';
import type { SmartTrackContext } from './smartPlaylistEngine';
import type { LockerEntry } from './lockerStorage';
import { artistAffinityKey } from './tasteProfile';

function trackKey(env: MediaEnvelope): string {
  return `${normalizeIdentityKey(env.artist ?? '')}::${normalizeIdentityKey(env.title ?? '')}`;
}

function toContext(env: MediaEnvelope): SmartTrackContext {
  const lockerId = env.envelopeId.startsWith('local-') ? env.envelopeId.slice(6) : env.envelopeId;
  const entry: LockerEntry = {
    id: env.sourceId ?? lockerId,
    title: env.title,
    artist: env.artist,
    genre: '',
    url: env.url,
    albumName: env.album,
    durationSeconds: env.durationSeconds ?? 0,
    addedAt: 0,
  };
  return {
    envelopeId: env.envelopeId,
    lockerId,
    title: env.title,
    artist: env.artist,
    album: env.album ?? '',
    genre: '',
    year: env.releaseYear ?? '',
    dateAdded: 0,
    playCount: 0,
    lastPlayedAt: 0,
    rating: 0,
    entry,
  };
}

function buildVibePrompt(playlist: StoredPlaylist): string {
  if (isSmartPlaylist(playlist) && playlist.rules?.extensions?.aiPrompt) {
    return playlist.rules.extensions.aiPrompt;
  }
  const artists = new Map<string, number>();
  for (const t of playlist.tracks) {
    const a = t.artist?.trim();
    if (!a) continue;
    artists.set(a, (artists.get(a) ?? 0) + 1);
  }
  const topArtists = [...artists.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([a]) => a);
  const titleWords = playlist.tracks
    .slice(0, 8)
    .map((t) => t.title)
    .join(' ');
  return [playlist.name, ...topArtists, titleWords].filter(Boolean).join(' ');
}

function sonicSimilarityToPlaylist(
  candidate: MediaEnvelope,
  playlistTracks: MediaEnvelope[],
): number {
  const cand = getSonicFeaturesForEnvelope(candidate);
  if (!cand?.bpm) return 0;
  let best = 0;
  for (const ref of playlistTracks.slice(0, 12)) {
    const refF = getSonicFeaturesForEnvelope(ref);
    if (!refF?.bpm) continue;
    const bpmDelta = Math.abs(cand.bpm - refF.bpm) / 40;
    const energyDelta = Math.abs((cand.energy ?? 0.5) - (refF.energy ?? 0.5));
    const sim = Math.max(0, sonicSimilarity(cand, refF) - bpmDelta * 0.15 - energyDelta * 0.1);
    if (sim > best) best = sim;
  }
  return best;
}

/** Suggest locker tracks to add based on playlist vibe (not already in playlist). */
export function suggestPlaylistEnhancements(
  playlist: StoredPlaylist,
  lockerPool: MediaEnvelope[],
  limit = 12,
): MediaEnvelope[] {
  if (playlist.tracks.length === 0 || lockerPool.length === 0) return [];

  const inPlaylist = new Set(playlist.tracks.map(trackKey));
  const prompt = buildVibePrompt(playlist);
  const playlistArtists = new Set(
    playlist.tracks.map((t) => artistAffinityKey(t.artist ?? '')),
  );

  const scored = lockerPool
    .filter((env) => env.url?.trim() && !inPlaylist.has(trackKey(env)))
    .map((env) => {
      const ctx = toContext(env);
      const vibe = scoreAiPromptMatch(ctx, prompt);
      const artistBoost = playlistArtists.has(artistAffinityKey(env.artist ?? '')) ? 0.25 : 0;
      const sonic = sonicSimilarityToPlaylist(env, playlist.tracks);
      return { env, score: vibe * 0.55 + sonic * 0.3 + artistBoost };
    })
    .filter((row) => row.score >= 0.2)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((r) => r.env);
}
