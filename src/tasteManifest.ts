/**
 * Federated taste profile recipes — signed locker manifests (no audio blobs).
 * Export/import genre weights, sonic prefs, artist seeds, station mix rules.
 */

import { getFollowedArtists } from './followedArtists';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { getSmartPlaylistPlayHistory } from './playHistory';
import { createSmartPlaylist } from './playlistStorage';
import {
  defaultCustomSmartRules,
  type SmartPlaylistRules,
} from './smartPlaylistEngine';
import { getSonicFeaturesForTrack, type SonicFeatures } from './sonicFeatures';
import {
  artistAffinityKey,
  getTasteProfile,
  mergeTasteRecipeWeights,
  type TasteProfileV1,
} from './tasteProfile';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  getTasteSigningMeta,
  signTastePayload,
  verifyTasteSignature,
} from './tasteSigning';

export const TASTE_MANIFEST_VERSION = 1;
export const TASTE_MANIFEST_FILE_EXT = '.sandbox-taste.json';
export const TASTE_MANIFEST_MIME = 'application/vnd.sandbox.taste+json';

export type TasteRecipeSeeds = {
  artistNames: string[];
  genres: string[];
};

export type TasteRecipeWeights = {
  genreAffinity: Record<string, number>;
  artistAffinity: Record<string, number>;
};

export type TasteSonicPrefs = {
  targetBpm?: number;
  targetEnergy?: number;
  targetSpectralCentroid?: number;
};

export type StationMixRules = {
  kind: 'sonic-locker' | 'smart-playlist';
  smartRules?: SmartPlaylistRules;
  seedArtist?: string;
  scoringHints?: {
    preferSessionMatch?: boolean;
    preferSonicSimilarity?: boolean;
  };
};

export type TasteRecipeIssuer = {
  displayName?: string;
  deviceId?: string;
  fingerprint?: string;
  keyId?: string;
};

export type TasteRecipePayload = {
  version: typeof TASTE_MANIFEST_VERSION;
  stationName: string;
  createdAt: number;
  seeds: TasteRecipeSeeds;
  weights: TasteRecipeWeights;
  sonicPrefs: TasteSonicPrefs;
  stationMix: StationMixRules;
  issuer?: TasteRecipeIssuer;
};

export type SignedTasteManifest = {
  kind: 'sandbox-taste-recipe';
  payload: TasteRecipePayload;
  contentHash: string;
  signature: string;
  publicKeySpki: string;
  signerKeyId: string;
};

export type TasteManifestVerification = {
  valid: boolean;
  contentHashOk: boolean;
  signatureOk: boolean;
  provenanceLabel: string | null;
};

export type ApplyTasteRecipeMode = 'merge' | 'new-station';

export type ApplyTasteRecipeResult = {
  verification: TasteManifestVerification;
  profile: TasteProfileV1;
  playlistId?: string;
  activeRecipe: TasteRecipePayload;
};

const DEVICE_ID_KEY = 'sandbox_locker_sync_device_id';
const ACTIVE_RECIPE_KEY = 'sandbox_active_sonic_recipe_v1';

const TOP_WEIGHT_LIMIT = 24;
const MERGE_STRENGTH = 0.55;

function getLocalDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'device-anonymous';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function topWeightedEntries(
  map: Record<string, number>,
  limit: number,
): Record<string, number> {
  const sorted = Object.entries(map)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const out: Record<string, number> = {};
  for (const [k, v] of sorted) out[k] = Math.round(v * 100) / 100;
  return out;
}

function reverseArtistKey(key: string, entries: ReturnType<typeof getLockerEntriesSnapshot>): string {
  const match = entries?.find((e) => artistAffinityKey(e.artist) === key);
  return match?.artist?.trim() || key.replace(/-/g, ' ');
}

function collectLikedArtistSeeds(profile: TasteProfileV1): string[] {
  const entries = getLockerEntriesSnapshot() ?? [];
  const events = profile.explicitFeedback;
  const names = new Set<string>();
  for (const [envelopeId, kind] of Object.entries(events)) {
    if (kind !== 'like') continue;
    const entry = entries.find((e) => e.id === envelopeId);
    if (entry?.artist?.trim()) names.add(entry.artist.trim());
  }
  return [...names].slice(0, TOP_WEIGHT_LIMIT);
}

function averageSonicFromProfile(profile: TasteProfileV1): TasteSonicPrefs {
  const entries = getLockerEntriesSnapshot() ?? [];
  const likedIds = Object.entries(profile.explicitFeedback)
    .filter(([, k]) => k === 'like')
    .map(([id]) => id)
    .slice(0, 12);

  const features: SonicFeatures[] = [];
  for (const id of likedIds) {
    const f = getSonicFeaturesForTrack(id);
    if (f) features.push(f);
  }
  if (features.length === 0) {
    const topTracks = Object.entries(profile.trackAffinity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
    for (const id of topTracks) {
      const f = getSonicFeaturesForTrack(id);
      if (f) features.push(f);
    }
  }
  if (features.length === 0) return {};

  const avg = (pick: (f: SonicFeatures) => number | undefined): number | undefined => {
    const vals = features.map(pick).filter((v): v is number => typeof v === 'number' && v > 0);
    if (vals.length === 0) return undefined;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  return {
    targetBpm: avg((f) => f.bpm),
    targetEnergy: avg((f) => f.energy),
    targetSpectralCentroid: avg((f) => f.spectralCentroid),
  };
}

function buildSmartRulesFromRecipe(
  seeds: TasteRecipeSeeds,
  weights: TasteRecipeWeights,
): SmartPlaylistRules {
  const rules = defaultCustomSmartRules();
  const topGenre = seeds.genres?.[0] ?? Object.keys(weights.genreAffinity)[0];
  const topArtist = seeds.artistNames?.[0];
  const conditions = [];
  if (topGenre) {
    conditions.push({
      id: `rule-genre-${Date.now()}`,
      field: 'genre' as const,
      operator: 'contains' as const,
      value: topGenre,
    });
  }
  if (topArtist) {
    conditions.push({
      id: `rule-artist-${Date.now()}`,
      field: 'artist' as const,
      operator: 'contains' as const,
      value: topArtist,
    });
  }
  if (conditions.length === 0) return rules;
  return {
    ...rules,
    conditions,
    sortBy: 'rating',
    sortDirection: 'desc',
    limit: 50,
  };
}

export function buildTasteRecipeFromProfile(options?: {
  stationName?: string;
  displayName?: string;
  stationMixKind?: StationMixRules['kind'];
}): TasteRecipePayload {
  const profile = getTasteProfile();
  const entries = getLockerEntriesSnapshot() ?? [];
  const followed = getFollowedArtists().map((a) => a.name.trim()).filter(Boolean);
  const likedArtists = collectLikedArtistSeeds(profile);

  const artistAffinity: Record<string, number> = {};
  for (const [key, weight] of Object.entries(profile.artistAffinity)) {
    artistAffinity[reverseArtistKey(key, entries)] = weight;
  }

  const genreAffinity = topWeightedEntries(profile.genreAffinity, TOP_WEIGHT_LIMIT);
  const genreSeeds = [
    ...Object.keys(genreAffinity),
    ...Object.entries(profile.genreAffinity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k),
  ]
    .map((g) => g.replace(/-/g, ' '))
    .filter((g, i, arr) => g && arr.indexOf(g) === i)
    .slice(0, TOP_WEIGHT_LIMIT);

  const artistSeeds = [...new Set([...followed, ...likedArtists, ...Object.keys(artistAffinity)])].slice(
    0,
    TOP_WEIGHT_LIMIT,
  );

  const seeds: TasteRecipeSeeds = {
    artistNames: artistSeeds,
    genres: genreSeeds,
  };
  const weights: TasteRecipeWeights = {
    genreAffinity,
    artistAffinity: topWeightedEntries(artistAffinity, TOP_WEIGHT_LIMIT),
  };
  const sonicPrefs = averageSonicFromProfile(profile);
  const stationMix: StationMixRules = {
    kind: options?.stationMixKind ?? 'sonic-locker',
    seedArtist: artistSeeds[0],
    scoringHints: {
      preferSessionMatch: true,
      preferSonicSimilarity: Boolean(sonicPrefs.targetBpm || sonicPrefs.targetEnergy),
    },
    smartRules: buildSmartRulesFromRecipe(seeds, weights),
  };

  return {
    version: TASTE_MANIFEST_VERSION,
    stationName: options?.stationName?.trim() || 'My taste station',
    createdAt: Date.now(),
    seeds,
    weights,
    sonicPrefs,
    stationMix,
    issuer: {
      displayName: options?.displayName?.trim() || undefined,
      deviceId: getLocalDeviceId(),
    },
  };
}

export function canonicalizeTastePayload(payload: TasteRecipePayload): string {
  return JSON.stringify(sortJsonValue(payload));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortJsonValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

async function sha256HexUtf8(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signTasteRecipe(
  payload: TasteRecipePayload,
): Promise<SignedTasteManifest> {
  const meta = await getTasteSigningMeta();
  const enriched: TasteRecipePayload = {
    ...payload,
    issuer: {
      ...payload.issuer,
      fingerprint: meta.deviceFingerprint ?? payload.issuer?.fingerprint,
      keyId: meta.keyId,
    },
  };
  const canonical = canonicalizeTastePayload(enriched);
  const contentHash = await sha256HexUtf8(canonical);
  const signed = await signTastePayload(canonical);

  return {
    kind: 'sandbox-taste-recipe',
    payload: enriched,
    contentHash,
    signature: signed.signature,
    publicKeySpki: signed.publicKeySpki,
    signerKeyId: signed.keyId,
  };
}

export async function exportSignedTasteRecipe(options?: {
  stationName?: string;
  displayName?: string;
  stationMixKind?: StationMixRules['kind'];
}): Promise<SignedTasteManifest> {
  const payload = buildTasteRecipeFromProfile(options);
  return signTasteRecipe(payload);
}

export function serializeTasteManifest(manifest: SignedTasteManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function downloadTasteManifestFile(manifest: SignedTasteManifest, filename?: string): void {
  const blob = new Blob([serializeTasteManifest(manifest)], {
    type: TASTE_MANIFEST_MIME,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    `${manifest.payload.stationName.replace(/[^\w.-]+/g, '-').slice(0, 48) || 'taste'}${TASTE_MANIFEST_FILE_EXT}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildTasteShareUrl(manifest: SignedTasteManifest, baseUrl?: string): string {
  const encoded = btoa(serializeTasteManifest(manifest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const origin =
    baseUrl?.trim() ||
    (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');
  return `${origin}#taste=${encoded}`;
}

export function parseTasteManifestJson(raw: string): SignedTasteManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON — expected a signed taste recipe manifest.');
  }
  return normalizeSignedManifest(parsed);
}

export function parseTasteManifestFromHash(hash: string): SignedTasteManifest | null {
  const match = hash.match(/(?:^#|[?&])taste=([^&]+)/);
  if (!match?.[1]) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    return parseTasteManifestJson(json);
  } catch {
    return null;
  }
}

function normalizeSignedManifest(raw: unknown): SignedTasteManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest must be an object.');
  }
  const obj = raw as Partial<SignedTasteManifest>;
  if (obj.kind !== 'sandbox-taste-recipe') {
    throw new Error('Unknown manifest kind — expected sandbox-taste-recipe.');
  }
  const payload = obj.payload as TasteRecipePayload | undefined;
  if (!payload || payload.version !== TASTE_MANIFEST_VERSION) {
    throw new Error(`Unsupported taste recipe version (expected ${TASTE_MANIFEST_VERSION}).`);
  }
  if (
    !payload.stationName ||
    !payload.seeds ||
    !payload.weights ||
    !payload.sonicPrefs ||
    !payload.stationMix
  ) {
    throw new Error('Manifest payload is missing required taste recipe fields.');
  }
  if (
    typeof obj.contentHash !== 'string' ||
    typeof obj.signature !== 'string' ||
    typeof obj.publicKeySpki !== 'string'
  ) {
    throw new Error('Manifest is missing signature metadata.');
  }
  return {
    kind: 'sandbox-taste-recipe',
    payload,
    contentHash: obj.contentHash,
    signature: obj.signature,
    publicKeySpki: obj.publicKeySpki,
    signerKeyId: typeof obj.signerKeyId === 'string' ? obj.signerKeyId : '',
  };
}

export async function verifyTasteManifest(
  manifest: SignedTasteManifest,
): Promise<TasteManifestVerification> {
  const canonical = canonicalizeTastePayload(manifest.payload);
  const contentHashOk = (await sha256HexUtf8(canonical)) === manifest.contentHash;
  const signatureOk =
    contentHashOk &&
    (await verifyTasteSignature(canonical, manifest.signature, manifest.publicKeySpki));
  const issuer = manifest.payload.issuer;
  let provenanceLabel: string | null = null;
  if (signatureOk) {
    provenanceLabel =
      issuer?.displayName?.trim() ||
      (issuer?.fingerprint
        ? `fingerprint ${issuer.fingerprint.slice(0, 12)}…`
        : issuer?.keyId
          ? `key ${issuer.keyId}`
          : 'verified signer');
  }
  return {
    valid: signatureOk,
    contentHashOk,
    signatureOk,
    provenanceLabel,
  };
}

export function getActiveSonicRecipeKey(): string {
  const recipe = getActiveSonicRecipe();
  return recipe ? canonicalizeTastePayload(recipe) : '';
}

export function getActiveSonicRecipe(): TasteRecipePayload | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(ACTIVE_RECIPE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TasteRecipePayload;
    if (parsed?.version !== TASTE_MANIFEST_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setActiveSonicRecipe(recipe: TasteRecipePayload | null): void {
  if (typeof localStorage === 'undefined') return;
  if (!recipe) {
    localStorage.removeItem(ACTIVE_RECIPE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_RECIPE_KEY, JSON.stringify(recipe));
  window.dispatchEvent(new Event('sandbox-taste-recipe-change'));
}

export function resolveSeedEnvelopeFromRecipe(
  recipe: TasteRecipePayload | null,
  pool: MediaEnvelope[],
): MediaEnvelope | undefined {
  if (!recipe) return undefined;
  const seedArtist = recipe.stationMix.seedArtist ?? recipe.seeds.artistNames?.[0];
  if (!seedArtist?.trim()) return undefined;
  const key = artistAffinityKey(seedArtist);
  return pool.find((env) => artistAffinityKey(env.artist ?? '') === key);
}

export async function applyTasteRecipe(
  manifest: SignedTasteManifest,
  mode: ApplyTasteRecipeMode = 'merge',
): Promise<ApplyTasteRecipeResult> {
  const verification = await verifyTasteManifest(manifest);
  const profile = mergeTasteRecipeWeights(manifest.payload.weights, MERGE_STRENGTH);
  setActiveSonicRecipe(manifest.payload);

  let playlistId: string | undefined;
  if (mode === 'new-station') {
    const entries = getLockerEntriesSnapshot() ?? [];
    const history = getSmartPlaylistPlayHistory();
    const mix = manifest.payload.stationMix;
    if (mix.kind === 'smart-playlist' && mix.smartRules) {
      const pl = createSmartPlaylist({
        name: manifest.payload.stationName,
        description: verification.valid
          ? `Shared recipe · ${verification.provenanceLabel ?? 'verified'}`
          : 'Imported taste recipe',
        rules: mix.smartRules,
        lockerEntries: entries,
        playHistory: history,
      });
      playlistId = pl.id;
    } else {
      const rules =
        mix.smartRules ?? buildSmartRulesFromRecipe(manifest.payload.seeds, manifest.payload.weights);
      const pl = createSmartPlaylist({
        name: manifest.payload.stationName,
        description: verification.valid
          ? `Sonic Locker recipe · ${verification.provenanceLabel ?? 'verified'}`
          : 'Sonic Locker imported recipe',
        rules,
        lockerEntries: entries,
        playHistory: history,
      });
      playlistId = pl.id;
    }
  }

  return {
    verification,
    profile,
    playlistId,
    activeRecipe: manifest.payload,
  };
}

export async function copyTasteManifestToClipboard(manifest: SignedTasteManifest): Promise<void> {
  await navigator.clipboard.writeText(serializeTasteManifest(manifest));
}
