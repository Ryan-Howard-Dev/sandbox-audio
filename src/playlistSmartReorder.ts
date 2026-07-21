/**
 * DJ-style playlist reorder using BPM + energy + Camelot key from local sonic analysis.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { getSonicFeaturesForEnvelope, lockerTrackKeyFromEnvelope } from './sonicFeatures';
import {
  analyzePlaylistSonicCoverage,
  reorderTracksBySonicPath,
  type PlaylistSonicCoverage,
} from './sonicReorderPolicy';

export type { PlaylistSonicCoverage };

/** Reorder tracks for smooth BPM/energy/key transitions. Tracks without analysis use defaults. */
export function smartReorderPlaylistTracks(tracks: MediaEnvelope[]): MediaEnvelope[] {
  return reorderTracksBySonicPath(tracks, { polish: true });
}

export function playlistHasSonicData(tracks: MediaEnvelope[]): boolean {
  return tracks.some((t) => {
    const key = lockerTrackKeyFromEnvelope(t);
    if (!key) return false;
    const sonic = getSonicFeaturesForEnvelope(t);
    return Boolean(sonic?.bpm);
  });
}

export function playlistHasKeyData(tracks: MediaEnvelope[]): boolean {
  return tracks.some((t) => Boolean(getSonicFeaturesForEnvelope(t)?.camelot));
}

export function smartReorderDetail(tracks: MediaEnvelope[]): PlaylistSonicCoverage['detail'] {
  return analyzePlaylistSonicCoverage(tracks).detail;
}

export function playlistReorderCoverage(tracks: MediaEnvelope[]): PlaylistSonicCoverage {
  return analyzePlaylistSonicCoverage(tracks);
}

export function smartReorderToastMessage(tracks: MediaEnvelope[]): string {
  const { detail } = analyzePlaylistSonicCoverage(tracks);
  if (detail === 'full') return 'Reordered by BPM, energy & key';
  if (detail === 'bpm') return 'Reordered by BPM & energy';
  return 'Reordered (limited sonic data — analyze tracks for best flow)';
}

export function smartReorderCoverageHint(tracks: MediaEnvelope[]): string | null {
  const { total, withBpm, withKey, detail } = analyzePlaylistSonicCoverage(tracks);
  if (total < 2) return null;
  if (detail === 'full') return `${withBpm}/${total} BPM · ${withKey}/${total} key`;
  if (detail === 'bpm') return `${withBpm}/${total} BPM analyzed`;
  return 'Analyze tracks for BPM & key-aware flow';
}

/** Queue sonic analysis for playlist locker tracks missing features. */
export function primePlaylistSonicAnalysis(
  tracks: MediaEnvelope[],
  limit = 16,
  ensure: (track: MediaEnvelope) => void,
): void {
  let queued = 0;
  for (const track of tracks) {
    if (queued >= limit) break;
    ensure(track);
    queued++;
  }
}
