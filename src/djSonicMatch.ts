/**
 * DJ deck helpers — BPM/key readout and harmonic track matching from sonic analysis.
 */

import { camelotSimilarity, camelotTransitionCost } from './camelot';
import { getSonicFeaturesForTrack } from './sonicFeatures';

export type LockerTrackSonic = {
  bpm?: number;
  camelot?: string;
  musicalKey?: string;
  source?: string;
};

export function readLockerTrackSonic(trackId: string): LockerTrackSonic | null {
  const features = getSonicFeaturesForTrack(trackId);
  if (!features) return null;
  return {
    bpm:
      features.bpm && features.bpm > 40 && features.bpm < 220 ? features.bpm : undefined,
    camelot: features.camelot,
    musicalKey: features.musicalKey,
    source: features.source,
  };
}

export function formatSonicDeckLabel(sonic: LockerTrackSonic | null): string | null {
  if (!sonic) return null;
  const parts: string[] = [];
  if (sonic.bpm) parts.push(`${Math.round(sonic.bpm)} BPM`);
  if (sonic.camelot) {
    parts.push(sonic.musicalKey ? `${sonic.camelot} ${sonic.musicalKey}` : sonic.camelot);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function findHarmonicMatchTrackId(
  sourceTrackId: string,
  candidates: Array<{ id: string }>,
  excludeIds: Set<string> = new Set(),
): string | null {
  const source = readLockerTrackSonic(sourceTrackId);
  if (!source?.camelot) return null;

  let bestId: string | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (candidate.id === sourceTrackId || excludeIds.has(candidate.id)) continue;
    const sonic = readLockerTrackSonic(candidate.id);
    if (!sonic?.camelot) continue;
    const score = camelotSimilarity(source.camelot, sonic.camelot);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId;
}

export function harmonicMatchLabel(sourceCamelot: string, targetCamelot: string): string {
  const cost = camelotTransitionCost(sourceCamelot, targetCamelot);
  if (cost <= 0.05) return 'Same key';
  if (cost <= 0.2) return 'Compatible';
  if (cost <= 0.45) return 'Adjacent';
  return 'Distant';
}
