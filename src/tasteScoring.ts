/**
 * Session + taste candidate scoring for mix/radio (local-only).
 *
 * score = 0.45 × sessionSimilarity
 *       + 0.25 × tasteAffinity (normalized scoreTrackForTaste)
 *       + 0.05–0.08 × genreMatch
 *       + 0.18 × sonicSimilarity (when seed + candidate features exist)
 *       + 0.12 × energyAlignment
 *       + 0.10 × artistNovelty (down-weight over-represented session artists)
 *
 * Explicit dislikes return DISQUALIFIED_SCORE (-999). Artists with any thumbed-down
 * track receive a heavy penalty. Genre is a minor signal; session + profile dominate.
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { getAllPlayEvents } from './playHistory';
import type { MediaEnvelope } from './sandboxLayer1';
import type { SessionVector } from './sessionTaste';
import {
  getSonicFeaturesForEnvelope,
  hasComparableSonicFeatures,
  sonicSimilarity,
  type SonicFeatures,
} from './sonicFeatures';
import { isEnvelopeSuppressed } from './tasteSuppressions';
import {
  artistAffinityKey,
  getExplicitFeedback,
  scoreTrackForTaste,
  type TasteProfileV1,
} from './tasteProfile';

export const DISQUALIFIED_SCORE = -999;

const W_SESSION = 0.45;
const W_TASTE = 0.25;
const W_GENRE_BASE = 0.08;
const W_GENRE_WITH_SONIC = 0.05;
const W_SONIC = 0.18;
const W_ENERGY = 0.12;
const W_NOVELTY = 0.1;

export type SessionScoreOptions = {
  /** Seed track for sonic similarity (track radio / mix). */
  seedEnvelope?: MediaEnvelope;
  seedFeatures?: SonicFeatures | null;
};

const ARTIST_SATURATION_THRESHOLD = 0.45;
const DISLIKED_ARTIST_PENALTY = -50;

let cachedDislikedArtists: Set<string> | null = null;
let cachedDislikedArtistsAt = 0;
const DISLIKED_ARTISTS_TTL_MS = 5000;

export function resolveEnvelopeGenre(envelope: MediaEnvelope): string {
  const entries = getLockerEntriesSnapshot() ?? [];
  const artist = normalizeIdentityKey(envelope.artist ?? '');
  const title = normalizeIdentityKey(envelope.title ?? '');
  const entry = entries.find(
    (e) =>
      normalizeIdentityKey(e.title) === title &&
      [e.artist, e.albumArtist ?? ''].some((a) => normalizeIdentityKey(a) === artist),
  );
  return entry?.genre?.trim() ?? '';
}

function sumRecordWeights(map: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(map)) total += v;
  return total || 1;
}

function normalizeTasteAffinity(raw: number): number {
  return Math.max(0, Math.min(1, (Math.tanh(raw / 5) + 1) / 2));
}

function getDislikedArtistKeys(profile: TasteProfileV1): Set<string> {
  const now = Date.now();
  if (cachedDislikedArtists && now - cachedDislikedArtistsAt < DISLIKED_ARTISTS_TTL_MS) {
    return cachedDislikedArtists;
  }

  const keys = new Set<string>();
  const events = getAllPlayEvents();
  const entries = getLockerEntriesSnapshot() ?? [];

  for (const [envelopeId, kind] of Object.entries(profile.explicitFeedback)) {
    if (kind !== 'dislike') continue;
    const event = events.find((e) => e.envelopeId === envelopeId);
    if (event?.artist) {
      keys.add(artistAffinityKey(event.artist));
      continue;
    }
    const entry = entries.find((e) => e.id === envelopeId);
    if (entry?.artist) keys.add(artistAffinityKey(entry.artist));
  }

  cachedDislikedArtists = keys;
  cachedDislikedArtistsAt = now;
  return keys;
}

function sessionSimilarity(envelope: MediaEnvelope, session: SessionVector): number {
  const aKey = artistAffinityKey(envelope.artist ?? '');
  const artistTotal = sumRecordWeights(session.artists);
  const artistShare = (session.artists[aKey] ?? 0) / artistTotal;
  let sim = Math.min(1, artistShare * 2.5);

  const id = envelope.envelopeId?.trim();
  if (id && session.trackIds.includes(id)) {
    sim *= 0.25;
  }

  return sim;
}

function genreMatch(envelope: MediaEnvelope, session: SessionVector): number {
  const genre = resolveEnvelopeGenre(envelope);
  if (!genre) return 0;
  const gKey = normalizeIdentityKey(genre);
  const genreTotal = sumRecordWeights(session.genres);
  return Math.min(1, ((session.genres[gKey] ?? 0) / genreTotal) * 2);
}

function energyAlignment(_envelope: MediaEnvelope, session: SessionVector): number {
  return Math.max(0, Math.min(1, session.avgEnergy));
}

function artistNovelty(envelope: MediaEnvelope, session: SessionVector): number {
  const aKey = artistAffinityKey(envelope.artist ?? '');
  const artistTotal = sumRecordWeights(session.artists);
  const share = (session.artists[aKey] ?? 0) / artistTotal;
  if (share >= ARTIST_SATURATION_THRESHOLD) return 0;
  return 1 - share;
}

function resolveSeedFeatures(options?: SessionScoreOptions): SonicFeatures | null {
  if (options?.seedFeatures) return options.seedFeatures;
  if (options?.seedEnvelope) return getSonicFeaturesForEnvelope(options.seedEnvelope);
  return null;
}

function sonicMatch(
  envelope: MediaEnvelope,
  options?: SessionScoreOptions,
): { score: number; active: boolean } {
  const seed = resolveSeedFeatures(options);
  const candidate = getSonicFeaturesForEnvelope(envelope);
  if (!hasComparableSonicFeatures(seed, candidate) || !seed || !candidate) {
    return { score: 0, active: false };
  }
  return { score: sonicSimilarity(seed, candidate), active: true };
}

export function isCandidateDisqualified(
  envelope: MediaEnvelope,
  profile: TasteProfileV1,
): boolean {
  if (isEnvelopeSuppressed(envelope)) return true;
  const id = envelope.envelopeId?.trim();
  if (id && getExplicitFeedback(id) === 'dislike') return true;
  const aKey = artistAffinityKey(envelope.artist ?? '');
  return getDislikedArtistKeys(profile).has(aKey);
}

export type TasteScoreFactor = {
  id: string;
  label: string;
  weight: number;
  raw: number;
  contribution: number;
  detail?: string;
};

export type TasteScoreBreakdown = {
  total: number;
  disqualified: boolean;
  factors: TasteScoreFactor[];
};

export function explainCandidateScore(
  envelope: MediaEnvelope,
  sessionVector: SessionVector,
  tasteProfile: TasteProfileV1,
  options?: SessionScoreOptions,
): TasteScoreBreakdown {
  if (isCandidateDisqualified(envelope, tasteProfile)) {
    return { total: DISQUALIFIED_SCORE, disqualified: true, factors: [] };
  }

  const sessionSim = sessionSimilarity(envelope, sessionVector);
  const tasteRaw = scoreTrackForTaste(envelope);
  const tasteNorm = normalizeTasteAffinity(tasteRaw);
  const genre = genreMatch(envelope, sessionVector);
  const energy = energyAlignment(envelope, sessionVector);
  const novelty = artistNovelty(envelope, sessionVector);
  const sonic = sonicMatch(envelope, options);
  const wGenre = sonic.active ? W_GENRE_WITH_SONIC : W_GENRE_BASE;
  const genreLabel = resolveEnvelopeGenre(envelope);

  const factors: TasteScoreFactor[] = [
    {
      id: 'session',
      label: 'Session match',
      weight: W_SESSION,
      raw: sessionSim,
      contribution: W_SESSION * sessionSim,
      detail: 'Recent artists and tracks in this listening session',
    },
    {
      id: 'taste',
      label: 'Taste profile',
      weight: W_TASTE,
      raw: tasteNorm,
      contribution: W_TASTE * tasteNorm,
      detail: 'Play history, likes, and artist affinity',
    },
    {
      id: 'genre',
      label: 'Genre match',
      weight: wGenre,
      raw: genre,
      contribution: wGenre * genre,
      detail: genreLabel ? `Genre: ${genreLabel}` : 'No genre metadata',
    },
    {
      id: 'energy',
      label: 'Energy alignment',
      weight: W_ENERGY,
      raw: energy,
      contribution: W_ENERGY * energy,
      detail: 'Completion-based session energy proxy',
    },
    {
      id: 'novelty',
      label: 'Artist variety',
      weight: W_NOVELTY,
      raw: novelty,
      contribution: W_NOVELTY * novelty,
      detail: 'Favors artists not over-represented this session',
    },
  ];

  if (sonic.active) {
    const seed = resolveSeedFeatures(options);
    factors.push({
      id: 'sonic',
      label: 'Sonic similarity',
      weight: W_SONIC,
      raw: sonic.score,
      contribution: W_SONIC * sonic.score,
      detail:
        seed?.bpm && getSonicFeaturesForEnvelope(envelope)?.bpm
          ? `BPM ~${Math.round(seed.bpm)} → ~${Math.round(getSonicFeaturesForEnvelope(envelope)!.bpm!)}`
          : 'Spectral / tempo features when analyzed',
    });
  }

  let total = factors.reduce((sum, f) => sum + f.contribution, 0);
  const aKey = artistAffinityKey(envelope.artist ?? '');
  if (getDislikedArtistKeys(tasteProfile).has(aKey)) {
    factors.push({
      id: 'disliked-artist',
      label: 'Disliked artist penalty',
      weight: 1,
      raw: DISLIKED_ARTIST_PENALTY,
      contribution: DISLIKED_ARTIST_PENALTY,
    });
    total += DISLIKED_ARTIST_PENALTY;
  }

  return { total, disqualified: false, factors };
}

export function scoreCandidateForSession(
  envelope: MediaEnvelope,
  sessionVector: SessionVector,
  tasteProfile: TasteProfileV1,
  options?: SessionScoreOptions,
): number {
  return explainCandidateScore(envelope, sessionVector, tasteProfile, options).total;
}
