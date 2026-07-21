/**
 * Sonic Locker — taste-scored smart radio queue from locker vault.
 */

import { getLockerEntriesSnapshot } from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import { getSessionVector } from './sessionTaste';
import {
  DISQUALIFIED_SCORE,
  explainCandidateScore,
  type TasteScoreBreakdown,
} from './tasteScoring';
import { getTasteProfile } from './tasteProfile';
import { ensureSonicAnalysisForEnvelope } from './sonicAnalysisQueue';
import {
  canonicalizeTastePayload,
  getActiveSonicRecipe,
  resolveSeedEnvelopeFromRecipe,
} from './tasteManifest';
import { normalizeIdentityKey } from './collectionIntelligence';

export type SonicLockerPick = {
  envelope: MediaEnvelope;
  breakdown: TasteScoreBreakdown;
};

export type SonicLockerQueueOptions = {
  /** Optional genre chip filter (Weekly Discover / My Mix continuation). */
  genreFilter?: string;
};

const SCORE_JITTER = 0.08;

/** Fingerprint for queue refresh — locker ids, taste profile, and active recipe. */
export function getSonicLockerScoringKey(lockerTracks: MediaEnvelope[]): string {
  const profile = getTasteProfile();
  const recipe = getActiveSonicRecipe();
  const lockerSig = lockerTracks
    .map((t) => `${t.envelopeId}:${t.title ?? ''}:${t.artist ?? ''}:${t.album ?? ''}`)
    .sort()
    .join('|');
  const recipeSig = recipe ? canonicalizeTastePayload(recipe) : '';
  return `${lockerSig}::${profile.updatedAt}::${recipeSig}`;
}

function lockerPool(): MediaEnvelope[] {
  const entries = getLockerEntriesSnapshot() ?? [];
  return entries.filter((e) => e.url?.trim()).map(lockerEntryToEnvelope);
}

function matchesGenreFilter(env: MediaEnvelope, genreFilter?: string): boolean {
  if (!genreFilter?.trim()) return true;
  const norm = normalizeIdentityKey(genreFilter);
  const hay = [env.title, env.artist, env.album, env.provider].join(' ').toLowerCase();
  return hay.includes(norm) || hay.includes(genreFilter.toLowerCase());
}

/** Build a taste-scored queue for Sonic Locker station playback. */
export function buildSonicLockerQueue(
  count = 24,
  seed?: MediaEnvelope,
  options?: SonicLockerQueueOptions,
): SonicLockerPick[] {
  const pool = lockerPool().filter((env) => matchesGenreFilter(env, options?.genreFilter));
  if (pool.length === 0) return [];

  const session = getSessionVector();
  const profile = getTasteProfile();
  const activeRecipe = getActiveSonicRecipe();
  const resolvedSeed =
    seed ?? resolveSeedEnvelopeFromRecipe(activeRecipe, pool);

  if (resolvedSeed) {
    ensureSonicAnalysisForEnvelope(resolvedSeed);
    let queued = 0;
    for (const env of pool) {
      if (queued >= 20) break;
      ensureSonicAnalysisForEnvelope(env);
      queued++;
    }
  }

  const scored = pool
    .map((env) => ({
      envelope: env,
      breakdown: explainCandidateScore(env, session, profile, {
        seedEnvelope: resolvedSeed,
      }),
    }))
    .filter((row) => row.breakdown.total > DISQUALIFIED_SCORE + 1);

  scored.sort(
    (a, b) =>
      b.breakdown.total +
      Math.random() * SCORE_JITTER -
      (a.breakdown.total + Math.random() * SCORE_JITTER),
  );

  const picks = scored.slice(0, count);
  if (resolvedSeed?.url?.trim()) {
    const seedId = resolvedSeed.envelopeId;
    const withoutSeed = picks.filter((p) => p.envelope.envelopeId !== seedId);
    const seedBreakdown = explainCandidateScore(resolvedSeed, session, profile, {
      seedEnvelope: resolvedSeed,
    });
    return [{ envelope: resolvedSeed, breakdown: seedBreakdown }, ...withoutSeed].slice(
      0,
      count,
    );
  }

  return picks;
}

/** Continuation picks when Sonic Locker or MFY mix/radio queue runs low. */
export function buildSonicLockerContinuation(
  excludeIds: Set<string>,
  count = 5,
  seed?: MediaEnvelope,
  options?: SonicLockerQueueOptions,
): SonicLockerPick[] {
  return buildSonicLockerQueue(Math.max(count * 3, 24), seed, options)
    .filter((p) => !excludeIds.has(p.envelope.envelopeId))
    .slice(0, count);
}
