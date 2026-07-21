/**
 * Sonic feature storage — local prefs map keyed by locker track id.
 * Browser BPM estimates are approximate; prefer relative similarity over absolute values.
 */

import {
  camelotFromTier34Slot,
  camelotSimilarity,
  camelotTransitionCost,
  parseMusicalKey,
  toCamelot,
} from './camelot';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope } from './sandboxLayer1';

export type SonicFeatureSource = 'analyzed' | 'tier34-stub' | 'estimated' | 'id3';

export type SonicFeatures = {
  bpm?: number;
  /** Brightness 0–1 normalized */
  spectralCentroid?: number;
  /** Zero-crossing rate 0–1 */
  zeroCrossingRate?: number;
  /** RMS / loudness proxy 0–1 */
  energy?: number;
  /** e.g. "Am", "F#", "8A" */
  musicalKey?: string;
  /** Camelot code e.g. "8A" */
  camelot?: string;
  source: SonicFeatureSource;
  analyzedAt: number;
};

const SONIC_FEATURES_KEY = 'sandbox_sonic_features_v1';
const MAX_STORED_TRACKS = 2000;

type SonicFeatureStore = Record<string, SonicFeatures>;

let cachedStore: SonicFeatureStore | null = null;

export function lockerTrackKeyFromEnvelope(envelope: MediaEnvelope): string | null {
  const id = envelope.envelopeId?.trim();
  if (!id) return null;
  if (id.startsWith('local-')) return id.slice('local-'.length);
  return id;
}

function readStore(): SonicFeatureStore {
  if (cachedStore) return cachedStore;
  try {
    const raw = prefsGetItem(SONIC_FEATURES_KEY);
    if (!raw) {
      cachedStore = {};
      return cachedStore;
    }
    const parsed = JSON.parse(raw) as SonicFeatureStore;
    cachedStore = parsed && typeof parsed === 'object' ? parsed : {};
    return cachedStore;
  } catch {
    cachedStore = {};
    return cachedStore;
  }
}

function trimStore(store: SonicFeatureStore): SonicFeatureStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_STORED_TRACKS) return store;
  const sorted = keys.sort(
    (a, b) => (store[a]?.analyzedAt ?? 0) - (store[b]?.analyzedAt ?? 0),
  );
  const drop = sorted.length - MAX_STORED_TRACKS;
  for (let i = 0; i < drop; i++) {
    delete store[sorted[i]!];
  }
  return store;
}

function writeStore(store: SonicFeatureStore): void {
  cachedStore = trimStore({ ...store });
  prefsSetItem(SONIC_FEATURES_KEY, JSON.stringify(cachedStore));
}

export function getSonicFeaturesForTrack(trackId: string): SonicFeatures | null {
  const key = trackId.trim();
  if (!key) return null;
  return readStore()[key] ?? null;
}

export function getSonicFeaturesForEnvelope(envelope: MediaEnvelope): SonicFeatures | null {
  const key = lockerTrackKeyFromEnvelope(envelope);
  if (!key) return null;
  return getSonicFeaturesForTrack(key);
}

export function setSonicFeaturesForTrack(trackId: string, features: SonicFeatures): void {
  const key = trackId.trim();
  if (!key) return;
  const store = readStore();
  store[key] = features;
  writeStore(store);
}

export function getSonicFeatureStats(): {
  analyzed: number;
  total: number;
  withBpm: number;
  withKey: number;
} {
  const store = readStore();
  const entries = Object.values(store);
  return {
    total: entries.length,
    analyzed: entries.filter((f) => f.source === 'analyzed').length,
    withBpm: entries.filter((f) => f.bpm && f.bpm > 40 && f.bpm < 220).length,
    withKey: entries.filter((f) => Boolean(f.camelot)).length,
  };
}

/** Map tier34 stub vector (energy, tempo, …) into comparable sonic features. */
export function sonicFeaturesFromTier34Vector(vector: number[]): SonicFeatures {
  const v = vector.length >= 8 ? vector : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const camelot = camelotFromTier34Slot(v[5] ?? 0.5);
  const parsed = parseMusicalKey(camelot);
  return {
    bpm: Math.round(60 + (v[1] ?? 0.5) * 140),
    spectralCentroid: Math.max(0, Math.min(1, 1 - (v[4] ?? 0.5) * 0.85)),
    zeroCrossingRate: Math.max(0, Math.min(1, (v[7] ?? 0.5) * 0.6 + 0.05)),
    energy: Math.max(0, Math.min(1, v[0] ?? 0.5)),
    musicalKey: parsed?.label,
    camelot,
    source: 'tier34-stub',
    analyzedAt: Date.now(),
  };
}

/** Apply musical key + Camelot from ID3 or notation string. */
export function applyMusicalKeyToFeatures(
  features: SonicFeatures,
  keyInput: string | undefined | null,
  source: SonicFeatureSource = 'id3',
): SonicFeatures {
  const parsed = parseMusicalKey(keyInput);
  const camelot = toCamelot(parsed) ?? toCamelot(keyInput);
  if (!parsed && !camelot) return features;
  return {
    ...features,
    musicalKey: parsed?.label ?? keyInput?.trim(),
    camelot: camelot ?? features.camelot,
    source: features.source === 'analyzed' ? features.source : source,
    analyzedAt: Date.now(),
  };
}

type SonicDimension = {
  a: number;
  b: number;
  scale: number;
};

function collectComparableDimensions(a: SonicFeatures, b: SonicFeatures): SonicDimension[] {
  const dims: SonicDimension[] = [];
  if (a.bpm != null && b.bpm != null) {
    dims.push({ a: a.bpm, b: b.bpm, scale: 60 });
  }
  if (a.spectralCentroid != null && b.spectralCentroid != null) {
    dims.push({ a: a.spectralCentroid, b: b.spectralCentroid, scale: 1 });
  }
  if (a.zeroCrossingRate != null && b.zeroCrossingRate != null) {
    dims.push({ a: a.zeroCrossingRate, b: b.zeroCrossingRate, scale: 1 });
  }
  if (a.energy != null && b.energy != null) {
    dims.push({ a: a.energy, b: b.energy, scale: 1 });
  }
  return dims;
}

/** 0 = identical, 1 = maximally different on available dimensions. */
export function normalizedSonicDistance(a: SonicFeatures, b: SonicFeatures): number {
  const dims = collectComparableDimensions(a, b);
  if (dims.length === 0) return 1;
  let sum = 0;
  for (const d of dims) {
    sum += Math.min(1, Math.abs(d.a - d.b) / d.scale);
  }
  return sum / dims.length;
}

/** 0–1 similarity; requires at least one shared dimension on both sides. */
export function sonicSimilarity(a: SonicFeatures, b: SonicFeatures): number {
  const dims = collectComparableDimensions(a, b);
  const hasKey = Boolean(a.camelot && b.camelot);
  if (dims.length === 0 && !hasKey) return 0;
  const base = dims.length > 0 ? 1 - normalizedSonicDistance(a, b) : 0;
  if (!hasKey) return base;
  const keySim = camelotSimilarity(a.camelot, b.camelot);
  if (dims.length === 0) return keySim;
  return base * 0.72 + keySim * 0.28;
}

export function harmonicTransitionCost(a: SonicFeatures | null, b: SonicFeatures | null): number {
  if (!a?.camelot || !b?.camelot) return 0.35;
  return camelotTransitionCost(a.camelot, b.camelot);
}

export function hasComparableSonicFeatures(a: SonicFeatures | null, b: SonicFeatures | null): boolean {
  if (!a || !b) return false;
  if (a.camelot && b.camelot) return true;
  return collectComparableDimensions(a, b).length > 0;
}
