/**
 * Lightweight suggested tracks for the queue drawer — locker + taste scoring.
 */

import { getLockerEntriesSnapshot } from './lockerStorage';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import type { MediaEnvelope } from './sandboxLayer1';
import { scoreTrackForTaste } from './tasteProfile';

function trackIdentity(env: MediaEnvelope): string {
  return `${(env.artist ?? '').trim().toLowerCase()}::${(env.title ?? '').trim().toLowerCase()}`;
}

/** Tracks to show under Queue → Suggested (not already in playQueue). */
export function buildSuggestedQueueTracks(
  seed: MediaEnvelope | null,
  playQueue: MediaEnvelope[],
  limit = 20,
): MediaEnvelope[] {
  if (!seed?.url?.trim()) return [];

  const inQueue = new Set(playQueue.map((e) => e.envelopeId));
  const seedIdentity = trackIdentity(seed);

  const entries = getLockerEntriesSnapshot() ?? [];
  const scored = entries
    .filter((e) => e.url?.trim())
    .map(lockerEntryToEnvelope)
    .filter((env) => !inQueue.has(env.envelopeId))
    .filter((env) => trackIdentity(env) !== seedIdentity)
    .map((env) => ({
      env,
      score: scoreTrackForTaste(env),
      sameArtist: (() => {
        const seedArtist = seed.artist?.trim().toLowerCase() ?? '';
        if (!seedArtist) return false;
        return (
          (env.artist ?? '').trim().toLowerCase().includes(seedArtist) ||
          seedArtist.includes((env.artist ?? '').trim().toLowerCase())
        );
      })(),
    }))
    .sort((a, b) => {
      if (a.sameArtist !== b.sameArtist) return a.sameArtist ? -1 : 1;
      return b.score - a.score;
    });

  return scored.slice(0, limit).map((row) => row.env);
}
