/**
 * Shared sonic transition costs for playlist reorder, mix ordering, and DJ tools.
 */

import { camelotTransitionCost } from './camelot';
import type { MediaEnvelope } from './sandboxLayer1';
import { getSonicFeaturesForEnvelope } from './sonicFeatures';

export type SonicTrackNode = {
  track: MediaEnvelope;
  bpm: number;
  energy: number;
  camelot?: string;
  musicalKey?: string;
  hasBpm: boolean;
  hasKey: boolean;
};

export type SonicTransitionWeights = {
  bpm: number;
  energy: number;
  harmonic: number;
  /** Cost when harmonic data missing on either side. */
  harmonicFallback: number;
};

export const DEFAULT_SONIC_TRANSITION_WEIGHTS: SonicTransitionWeights = {
  bpm: 0.45,
  energy: 0.25,
  harmonic: 0.55,
  harmonicFallback: 0.35,
};

const DEFAULT_BPM = 120;
const DEFAULT_ENERGY = 0.5;

export function buildSonicTrackNode(track: MediaEnvelope): SonicTrackNode {
  const sonic = getSonicFeaturesForEnvelope(track);
  const bpm = sonic?.bpm && sonic.bpm > 40 && sonic.bpm < 220 ? sonic.bpm : DEFAULT_BPM;
  return {
    track,
    bpm,
    energy: sonic?.energy ?? DEFAULT_ENERGY,
    camelot: sonic?.camelot,
    musicalKey: sonic?.musicalKey,
    hasBpm: Boolean(sonic?.bpm && sonic.bpm > 40 && sonic.bpm < 220),
    hasKey: Boolean(sonic?.camelot),
  };
}

export function sonicTransitionCost(
  from: SonicTrackNode,
  to: SonicTrackNode,
  weights: SonicTransitionWeights = DEFAULT_SONIC_TRANSITION_WEIGHTS,
): number {
  const bpmDelta = Math.abs(from.bpm - to.bpm) / 40;
  const energyDelta = Math.abs(from.energy - to.energy);
  const harmonic =
    from.camelot && to.camelot
      ? camelotTransitionCost(from.camelot, to.camelot)
      : weights.harmonicFallback;

  if (from.hasKey && to.hasKey) {
    return (
      bpmDelta * weights.bpm + energyDelta * weights.energy + harmonic * weights.harmonic
    );
  }
  return bpmDelta + energyDelta * 0.6;
}

export function pathTransitionCost(order: number[], nodes: SonicTrackNode[]): number {
  if (order.length <= 1) return 0;
  let sum = 0;
  for (let i = 0; i < order.length - 1; i++) {
    sum += sonicTransitionCost(nodes[order[i]!]!, nodes[order[i + 1]!]!);
  }
  return sum;
}

/** Start from a high-energy track; prefer one with key data when available. */
export function pickReorderStartIndex(nodes: SonicTrackNode[]): number {
  if (nodes.length === 0) return 0;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const score = n.energy + (n.hasKey ? 0.15 : 0) + (n.hasBpm ? 0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function greedySonicReorder(nodes: SonicTrackNode[], startIdx?: number): number[] {
  if (nodes.length <= 1) return nodes.map((_, i) => i);

  const remaining = new Set(nodes.map((_, i) => i));
  const order: number[] = [];
  let currentIdx = startIdx ?? pickReorderStartIndex(nodes);

  remaining.delete(currentIdx);
  order.push(currentIdx);

  while (remaining.size > 0) {
    let nextIdx = -1;
    let bestCost = Infinity;
    for (const idx of remaining) {
      const cost = sonicTransitionCost(nodes[currentIdx]!, nodes[idx]!);
      if (cost < bestCost) {
        bestCost = cost;
        nextIdx = idx;
      }
    }
    if (nextIdx < 0) break;
    remaining.delete(nextIdx);
    order.push(nextIdx);
    currentIdx = nextIdx;
  }

  return order;
}

/** Light 2-opt polish for small playlists. */
export function twoOptImprove(order: number[], nodes: SonicTrackNode[], maxPasses = 2): number[] {
  if (order.length < 4) return order;
  let current = [...order];

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 1; i < current.length - 2; i++) {
      for (let j = i + 1; j < current.length; j++) {
        if (j - i === 1) continue;
        const next = [...current];
        const segment = next.slice(i, j + 1).reverse();
        next.splice(i, j - i + 1, ...segment);
        if (pathTransitionCost(next, nodes) + 1e-6 < pathTransitionCost(current, nodes)) {
          current = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return current;
}

export function reorderTracksBySonicPath(
  tracks: MediaEnvelope[],
  options?: { polish?: boolean },
): MediaEnvelope[] {
  if (tracks.length <= 1) return [...tracks];
  const nodes = tracks.map(buildSonicTrackNode);
  let order = greedySonicReorder(nodes);
  if (options?.polish !== false && tracks.length <= 64) {
    order = twoOptImprove(order, nodes);
  }
  return order.map((idx) => nodes[idx]!.track);
}

export type PlaylistSonicCoverage = {
  total: number;
  withBpm: number;
  withKey: number;
  detail: 'full' | 'bpm' | 'none';
};

export function analyzePlaylistSonicCoverage(tracks: MediaEnvelope[]): PlaylistSonicCoverage {
  const nodes = tracks.map(buildSonicTrackNode);
  const withBpm = nodes.filter((n) => n.hasBpm).length;
  const withKey = nodes.filter((n) => n.hasKey).length;
  let detail: PlaylistSonicCoverage['detail'] = 'none';
  if (withBpm > 0 && withKey > 0) detail = 'full';
  else if (withBpm > 0) detail = 'bpm';
  return { total: tracks.length, withBpm, withKey, detail };
}
