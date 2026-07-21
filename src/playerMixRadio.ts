/**
 * Artist mix and track radio — built from locker vault + catalog previews.
 */

import { acquireSearchHit } from './acquisitionPipeline';
import { normalizeIdentityKey } from './collectionIntelligence';
import {
  enqueueDownloadJob,
  initJobTracks,
  type DownloadTierPreference,
} from './downloadQueue';
import { getLockerEntriesSnapshot } from './lockerStorage';
import type { LockerEntry } from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import { fetchArtistTopTracks, fetchSearchCatalog } from './searchCatalog';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import { getSessionVector, type SessionVector } from './sessionTaste';
import { ensureSonicAnalysisForEnvelope } from './sonicAnalysisQueue';
import { analyzePlaylistSonicCoverage, reorderTracksBySonicPath } from './sonicReorderPolicy';
import { DISQUALIFIED_SCORE, scoreCandidateForSession } from './tasteScoring';
import { getTasteProfile, isNewArtistTrack, scoreTrackForTaste } from './tasteProfile';

import type { DiscoveryMix, DiscoveryMixKind } from './discoveryMixes';

export type MixRadioSession = {
  kind: 'mix' | 'radio' | 'discovery-station' | 'discovery-mfy';
  seedTitle: string;
  seedArtist: string;
  /** Skip-only endless radio — hide seek/queue in player chrome. */
  skipOnly?: boolean;
  /** Made For You mix identity for queue extension. */
  discoveryMixId?: string;
  discoveryMixKind?: DiscoveryMixKind;
};

const SCORE_JITTER = 0.12;

export const MIX_RADIO_FAMILIAR_RATIO = 0.7;
export const MIX_RADIO_NEW_ARTIST_RATIO = 0.3;

/** Taste-scored candidate ordering shared with Sonic Locker and MFY mix generation. */
export function scoreMixRadioCandidates(
  candidates: MediaEnvelope[],
  sessionVector: SessionVector | null,
  seed?: MediaEnvelope,
): MediaEnvelope[] {
  return scoreAndOrderCandidates(candidates, sessionVector, seed);
}

function scoreAndOrderCandidates(
  candidates: MediaEnvelope[],
  sessionVector: SessionVector | null,
  seed?: MediaEnvelope,
): MediaEnvelope[] {
  const profile = getTasteProfile();
  const session = sessionVector ?? getSessionVector();
  if (seed) {
    ensureSonicAnalysisForEnvelope(seed);
    let queued = 0;
    for (const env of candidates) {
      if (queued >= 16) break;
      ensureSonicAnalysisForEnvelope(env);
      queued++;
    }
  }

  const scored = candidates
    .map((env) => ({
      env,
      score: session
        ? scoreCandidateForSession(env, session, profile, { seedEnvelope: seed })
        : scoreTrackForTaste(env),
    }))
    .filter((row) => row.score > DISQUALIFIED_SCORE + 1);

  scored.sort((a, b) => b.score + Math.random() * SCORE_JITTER - (a.score + Math.random() * SCORE_JITTER));
  return scored.map((row) => row.env);
}

function orderMixRadioRest(rest: MediaEnvelope[], seed: MediaEnvelope): MediaEnvelope[] {
  if (rest.length === 0) return rest;
  const scored = scoreAndOrderCandidates(rest, getSessionVector(), seed);
  // Taste scoring can disqualify everything — never leave a single dead-ended.
  return scored.length > 0 ? scored : [...rest].sort(() => Math.random() - 0.5);
}

/** DJ-style ordering — first track is seed when provided. */
export function orderMixRadioTracks(
  tracks: MediaEnvelope[],
  seed?: MediaEnvelope,
): MediaEnvelope[] {
  if (tracks.length <= 1) return [...tracks];
  const first = seed ?? tracks[0]!;
  const rest = tracks.filter((t) => trackKey(t) !== trackKey(first));
  return rest.length > 0 ? [first, ...orderMixRadioRest(rest, first)] : [first];
}

function trackKey(env: MediaEnvelope): string {
  return `${normalizeIdentityKey(env.artist ?? '')}::${normalizeIdentityKey(env.title ?? '')}`;
}

function dedupeEnvelopes(envs: MediaEnvelope[]): MediaEnvelope[] {
  const seen = new Set<string>();
  const out: MediaEnvelope[] = [];
  for (const env of envs) {
    const key = trackKey(env);
    if (seen.has(key)) continue;
    seen.add(key);
    if (env.url?.trim()) out.push(env);
  }
  return out;
}

function artistMatchesEntry(artist: string, entry: LockerEntry): boolean {
  const q = normalizeIdentityKey(artist);
  if (!q) return false;
  const candidates = [entry.artist, entry.albumArtist ?? ''].map(normalizeIdentityKey);
  return candidates.some((a) => a === q || a.includes(q) || q.includes(a));
}

function lockerArtistTracks(artist: string, entries: LockerEntry[]): MediaEnvelope[] {
  return entries
    .filter((e) => e.url?.trim() && artistMatchesEntry(artist, e))
    .map(lockerEntryToEnvelope);
}

function lockerGenreTracks(genre: string, entries: LockerEntry[], limit = 40): MediaEnvelope[] {
  const g = genre.trim().toLowerCase();
  if (!g) return [];
  return entries
    .filter((e) => e.url?.trim() && (e.genre ?? '').toLowerCase().includes(g))
    .slice(0, limit)
    .map(lockerEntryToEnvelope);
}

function catalogTracksToEnvelopes(
  tracks: Awaited<ReturnType<typeof fetchArtistTopTracks>>,
): MediaEnvelope[] {
  return tracks
    .map((t) => t.envelope)
    .filter((env): env is MediaEnvelope => Boolean(env?.url?.trim()));
}

/** Shuffle same-artist locker tracks + catalog top tracks; seed stays first. */
export async function buildArtistMix(seed: MediaEnvelope): Promise<MediaEnvelope[]> {
  ensureSonicAnalysisForEnvelope(seed);
  const artist = seed.artist?.trim();
  if (!artist) return seed.url?.trim() ? [seed] : [];

  const entries = getLockerEntriesSnapshot() ?? [];
  const local = lockerArtistTracks(artist, entries);

  let catalog: MediaEnvelope[] = [];
  try {
    catalog = catalogTracksToEnvelopes(await fetchArtistTopTracks(artist, undefined, 30));
  } catch {
    /* locker-only fallback */
  }

  const combined = dedupeEnvelopes([seed, ...local, ...catalog]);
  const rest = combined.filter((e) => trackKey(e) !== trackKey(seed));
  return rest.length > 0 ? [seed, ...orderMixRadioRest(rest, seed)] : [seed];
}

/** Endless-style radio: seed artist + genre locker tracks + catalog + related genre picks. */
export async function buildTrackRadio(seed: MediaEnvelope): Promise<MediaEnvelope[]> {
  ensureSonicAnalysisForEnvelope(seed);
  const artist = seed.artist?.trim();
  if (!artist) return seed.url?.trim() ? [seed] : [];

  const entries = getLockerEntriesSnapshot() ?? [];
  const localArtist = lockerArtistTracks(artist, entries);

  const seedEntry = entries.find(
    (e) =>
      normalizeIdentityKey(e.title) === normalizeIdentityKey(seed.title ?? '') &&
      artistMatchesEntry(artist, e),
  );
  const genre = seedEntry?.genre ?? '';
  const genreTracks = lockerGenreTracks(genre, entries);

  let catalog: MediaEnvelope[] = [];
  let related: MediaEnvelope[] = [];
  try {
    catalog = catalogTracksToEnvelopes(await fetchArtistTopTracks(artist, undefined, 35));
    if (genre.trim()) {
      const result = await fetchSearchCatalog(genre);
      related = result.tracks
        .filter((t) => normalizeIdentityKey(t.artist) !== normalizeIdentityKey(artist))
        .map((t) => t.envelope)
        .filter((env): env is MediaEnvelope => Boolean(env?.url?.trim()))
        .slice(0, 25);
    }
  } catch {
    /* locker-only fallback */
  }

  const combined = dedupeEnvelopes([seed, ...localArtist, ...genreTracks, ...catalog, ...related]);
  const rest = combined.filter((e) => trackKey(e) !== trackKey(seed));
  return rest.length > 0 ? [seed, ...orderMixRadioRest(rest, seed)] : [seed];
}

/**
 * Last-resort continue-listening queue: any other playable locker tracks.
 * Used when artist/catalog radio cannot find neighbors for a lone single.
 */
export function buildLockerShuffleRadio(seed: MediaEnvelope, limit = 40): MediaEnvelope[] {
  const entries = getLockerEntriesSnapshot() ?? [];
  const pool = entries
    .filter(
      (e) =>
        Boolean(e.url?.trim()) &&
        trackKey(lockerEntryToEnvelope(e)) !== trackKey(seed),
    )
    .map(lockerEntryToEnvelope);
  if (pool.length === 0) return seed.url?.trim() ? [seed] : [];
  const ordered = orderMixRadioRest(pool, seed).slice(0, limit);
  return [seed, ...ordered];
}

/** Scored continuation picks when a mix/radio queue runs out (locker pool only). */
export function buildSessionContinuationCandidates(
  seed: MediaEnvelope,
  excludeIds: Set<string>,
  count = 3,
): MediaEnvelope[] {
  const artist = seed.artist?.trim();
  if (!artist) return [];

  const entries = getLockerEntriesSnapshot() ?? [];
  const seedEntry = entries.find(
    (e) =>
      normalizeIdentityKey(e.title) === normalizeIdentityKey(seed.title ?? '') &&
      artistMatchesEntry(artist, e),
  );
  const genre = seedEntry?.genre ?? '';
  const pool = dedupeEnvelopes([
    ...lockerArtistTracks(artist, entries),
    ...lockerGenreTracks(genre, entries, 60),
  ]).filter(
    (e) =>
      trackKey(e) !== trackKey(seed) &&
      !excludeIds.has(e.envelopeId) &&
      Boolean(e.url?.trim()),
  );

  return scoreAndOrderCandidates(pool, getSessionVector(), seed).slice(0, count);
}

function genreHaystack(env: MediaEnvelope): string {
  return [env.title, env.artist, env.album, env.provider].join(' ').toLowerCase();
}

function matchesMixRadioGenreFilter(env: MediaEnvelope, genreFilter?: string): boolean {
  if (!genreFilter?.trim()) return true;
  const norm = normalizeIdentityKey(genreFilter);
  const hay = genreHaystack(env);
  return hay.includes(norm) || hay.includes(genreFilter.toLowerCase());
}

type ScoredDiscoveryRow = { env: MediaEnvelope; score: number; isNew: boolean };

function scoreDiscoveryPoolRows(
  pool: MediaEnvelope[],
  profile: ReturnType<typeof getTasteProfile>,
  session: SessionVector | null,
  genreFilter?: string,
): ScoredDiscoveryRow[] {
  return pool
    .map((env) => ({
      env,
      score: session
        ? scoreCandidateForSession(env, session, profile)
        : scoreTrackForTaste(env),
      isNew: isNewArtistTrack(env, profile),
    }))
    .filter((row) => row.score > DISQUALIFIED_SCORE + 1)
    .filter((row) => matchesMixRadioGenreFilter(row.env, genreFilter));
}

/**
 * MFY / discovery mix composition — 70% taste-familiar + 30% new-artist picks.
 * Same scoring path as artist mix, track radio, and Sonic Locker.
 */
export function composeMixRadioDiscoveryPool(
  pool: MediaEnvelope[],
  totalSize: number,
  options?: { genreFilter?: string; session?: SessionVector | null; familiarRatio?: number },
): MediaEnvelope[] {
  if (pool.length === 0 || totalSize <= 0) return [];

  const profile = getTasteProfile();
  const session = options?.session ?? getSessionVector();
  const familiarRatio = options?.familiarRatio ?? MIX_RADIO_FAMILIAR_RATIO;
  const rows = scoreDiscoveryPoolRows(pool, profile, session, options?.genreFilter);

  const familiarTarget = Math.round(totalSize * familiarRatio);
  const newTarget = totalSize - familiarTarget;

  const familiar = rows
    .filter((r) => !r.isNew)
    .sort((a, b) => b.score - a.score + (Math.random() - 0.5) * 0.06);
  const novel = rows
    .filter((r) => r.isNew)
    .sort((a, b) => b.score - a.score + (Math.random() - 0.5) * 0.1);

  const picked: MediaEnvelope[] = [];
  const seen = new Set<string>();

  const take = (list: ScoredDiscoveryRow[], n: number) => {
    for (const row of list) {
      if (picked.length >= totalSize || n <= 0) break;
      const key = trackKey(row.env);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row.env);
      n -= 1;
    }
    return n;
  };

  let newLeft = take(novel, newTarget);
  let famLeft = take(familiar, familiarTarget);

  if (famLeft > 0) take(familiar, famLeft);
  if (newLeft > 0) take(novel, newLeft);
  if (picked.length < totalSize) {
    const rest = [...rows].sort((a, b) => b.score - a.score);
    take(rest, totalSize - picked.length);
  }

  return picked.slice(0, totalSize);
}

/** Made For You → mix-radio session metadata. */
export function discoveryMixRadioSession(mix: DiscoveryMix): MixRadioSession {
  return {
    kind: 'discovery-mfy',
    seedTitle: mix.title,
    seedArtist: mix.subtitle || 'Made for you',
    discoveryMixId: mix.id,
    discoveryMixKind: mix.kind,
  };
}

/** Taste-scored + sonic-aware play order for an MFY mix. */
export function prepareDiscoveryMixQueue(
  mix: DiscoveryMix,
  tracks: MediaEnvelope[] = mix.tracks,
): MediaEnvelope[] {
  if (tracks.length === 0) return [];

  let primed = 0;
  for (const track of tracks) {
    if (primed >= 20) break;
    ensureSonicAnalysisForEnvelope(track);
    primed++;
  }

  const { detail } = analyzePlaylistSonicCoverage(tracks);
  if (detail !== 'none') {
    return reorderTracksBySonicPath(tracks, { polish: true });
  }
  return orderMixRadioTracks(tracks);
}

export function isDiscoveryMixRadioSession(session: MixRadioSession | null): boolean {
  return session?.kind === 'discovery-mfy';
}

export type MixRadioLockerResult = {
  downloaded: number;
  skipped: number;
  failed: number;
};

/** Download mix/radio tracks to locker as full audio files when available. */
export async function saveMixRadioToLocker(
  tracks: MediaEnvelope[],
  tier: DownloadTierPreference,
  label: string,
): Promise<MixRadioLockerResult> {
  const result: MixRadioLockerResult = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
  };
  if (tracks.length === 0) return result;

  const pending = tracks.filter((t) => t.provider !== 'local-vault' && t.url?.trim());
  result.skipped = tracks.length - pending.length;

  if (pending.length === 0) return result;

  const job = enqueueDownloadJob({
    label,
    artist: pending[0]?.artist?.trim() || 'Various',
    mode: 'tracks',
    tier,
    totalTracks: pending.length,
  });
  initJobTracks(
    job.id,
    pending.map((t) => ({ id: t.envelopeId, title: t.title })),
  );

  for (const track of pending) {
    try {
      const acquired = await acquireSearchHit(track, tier, job.id);
      if (acquired.saved > 0) {
        result.downloaded += acquired.saved;
        continue;
      }
      if (acquired.skipped > 0) {
        result.skipped += 1;
        continue;
      }
      result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
