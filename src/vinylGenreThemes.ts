/**
 * Official Sandbox genre → vinyl visual presets (not community packs).
 * Used when display mode is "Follow genre".
 */

import { getLockerEntriesSnapshot } from './lockerStorage';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { OFFICIAL_PRESET_IDS, getOfficialPresets, type RecordPlayerAddon } from './recordPlayerAddons';
import type { MediaEnvelope } from './sandboxLayer1';
import { resolveEnvelopeGenre } from './tasteScoring';
import { getTasteProfile } from './tasteProfile';
import type { VinylVisualSettings } from './vinylVisualSettings';
import {
  getVinylShadeById,
  getVinylShades,
  isVinylShadeId,
  type VinylShade,
} from './vinylShadePalette';

export const VINYL_GENRE_OVERRIDES_KEY = 'sandbox_vinyl_genre_overrides_v1';

const VINYL_VISUAL_KEYS: (keyof VinylVisualSettings)[] = [
  'universeIntensity',
  'colorThrow',
  'pulse',
  'hueDrift',
  'spinTrail',
  'warp',
];

const DEFAULT_GENRE_VISUAL_PRESET: VinylVisualSettings = {
  universeIntensity: 0,
  colorThrow: 0,
  pulse: 0,
  hueDrift: 0,
  spinTrail: 0,
  warp: 0,
  artBlend: 0,
};

export type VinylGenreBucket =
  | 'hip-hop'
  | 'electronic'
  | 'rock'
  | 'jazz'
  | 'pop'
  | 'rnb'
  | 'default';

export interface GenreVinylPreset {
  id: string;
  name: string;
  bucket: VinylGenreBucket;
  visualPreset: Partial<VinylVisualSettings>;
  cssVars?: Record<string, string>;
  vinylClass?: string;
}

export const GENRE_BUCKET_LABELS: Record<VinylGenreBucket, string> = {
  'hip-hop': 'Hip-Hop',
  electronic: 'Electronic',
  rock: 'Rock',
  jazz: 'Jazz',
  pop: 'Pop',
  rnb: 'R&B',
  default: 'Default / Unknown',
};

/** Official genre presets — author Sandbox Music, not community. */
export const OFFICIAL_GENRE_PRESETS: Record<VinylGenreBucket, GenreVinylPreset> = {
  'hip-hop': {
    id: 'genre-hip-hop',
    name: 'Warm Dark',
    bucket: 'hip-hop',
    visualPreset: {
      universeIntensity: 35,
      colorThrow: 25,
      pulse: 40,
      hueDrift: 8,
      spinTrail: 12,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-warmth': '0.55', '--vinyl-addon-tint': '#8b4513' },
    vinylClass: 'vinyl-addon-vinyl-warmth',
  },
  electronic: {
    id: 'genre-electronic',
    name: 'Neon Drift',
    bucket: 'electronic',
    visualPreset: {
      universeIntensity: 55,
      colorThrow: 70,
      pulse: 35,
      hueDrift: 60,
      spinTrail: 40,
      warp: 15,
    },
    cssVars: { '--vinyl-addon-glow': '0.85', '--vinyl-addon-tint': '#7b2fff' },
    vinylClass: 'vinyl-addon-neon-trip',
  },
  rock: {
    id: 'genre-rock',
    name: 'Classic Pulse',
    bucket: 'rock',
    visualPreset: {
      universeIntensity: 25,
      colorThrow: 15,
      pulse: 50,
      hueDrift: 5,
      spinTrail: 10,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-glow': '0.35' },
  },
  jazz: {
    id: 'genre-jazz',
    name: 'Vinyl Warmth',
    bucket: 'jazz',
    visualPreset: {
      universeIntensity: 30,
      colorThrow: 20,
      pulse: 45,
      hueDrift: 10,
      spinTrail: 15,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-warmth': '0.7', '--vinyl-addon-tint': '#e8a04a' },
    vinylClass: 'vinyl-addon-vinyl-warmth',
  },
  pop: {
    id: 'genre-pop',
    name: 'Subtle Bright',
    bucket: 'pop',
    visualPreset: {
      universeIntensity: 18,
      colorThrow: 22,
      pulse: 20,
      hueDrift: 12,
      spinTrail: 8,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-glow': '0.4', '--vinyl-addon-tint': '#f0e6ff' },
  },
  rnb: {
    id: 'genre-rnb',
    name: 'Purple Magenta',
    bucket: 'rnb',
    visualPreset: {
      universeIntensity: 45,
      colorThrow: 40,
      pulse: 55,
      hueDrift: 30,
      spinTrail: 18,
      warp: 8,
    },
    cssVars: { '--vinyl-addon-glow': '0.6', '--vinyl-addon-tint': '#a855f7' },
    vinylClass: 'vinyl-addon-community-pulse',
  },
  default: {
    id: 'genre-default',
    name: 'Classic Void',
    bucket: 'default',
    visualPreset: DEFAULT_GENRE_VISUAL_PRESET,
  },
};

/** Default genre bucket → shade id (user overrides merged at runtime). */
export const GENRE_SHADE_MAP: Record<VinylGenreBucket, string> = {
  'hip-hop': 'warm-amber',
  electronic: 'neon-cyan',
  rock: 'classic-pulse',
  jazz: 'classic-orange',
  pop: 'subtle-bright',
  rnb: 'magenta-glow',
  default: 'void-black',
};

/** @deprecated Use GENRE_SHADE_MAP — kept for legacy preset id references. */
export const GENRE_PRESET_MAP: Record<VinylGenreBucket, string> = {
  'hip-hop': OFFICIAL_GENRE_PRESETS['hip-hop'].id,
  electronic: OFFICIAL_GENRE_PRESETS.electronic.id,
  rock: OFFICIAL_GENRE_PRESETS.rock.id,
  jazz: OFFICIAL_GENRE_PRESETS.jazz.id,
  pop: OFFICIAL_GENRE_PRESETS.pop.id,
  rnb: OFFICIAL_GENRE_PRESETS.rnb.id,
  default: OFFICIAL_GENRE_PRESETS.default.id,
};

/** Maps legacy genre preset ids and official addon ids → shade ids. */
const PRESET_ID_TO_SHADE_ID: Record<string, string> = {
  [OFFICIAL_GENRE_PRESETS['hip-hop'].id]: 'warm-amber',
  [OFFICIAL_GENRE_PRESETS.electronic.id]: 'neon-cyan',
  [OFFICIAL_GENRE_PRESETS.rock.id]: 'classic-pulse',
  [OFFICIAL_GENRE_PRESETS.jazz.id]: 'classic-orange',
  [OFFICIAL_GENRE_PRESETS.pop.id]: 'subtle-bright',
  [OFFICIAL_GENRE_PRESETS.rnb.id]: 'magenta-glow',
  [OFFICIAL_GENRE_PRESETS.default.id]: 'void-black',
  [OFFICIAL_PRESET_IDS.classicVoid]: 'void-black',
  [OFFICIAL_PRESET_IDS.neonTrip]: 'neon-cyan',
  [OFFICIAL_PRESET_IDS.vinylWarmth]: 'classic-orange',
  [OFFICIAL_PRESET_IDS.tvHypnosis]: 'tv-hypnosis',
};

export function shadeToGenrePreset(shade: VinylShade, bucket: VinylGenreBucket): GenreVinylPreset {
  return {
    id: `shade-${shade.id}`,
    name: shade.name,
    bucket,
    visualPreset: shade.visualPreset,
    cssVars: shade.cssVars,
    vinylClass: shade.vinylClass,
  };
}

function normalizeOverrideToShadeId(raw: string): string | null {
  if (isVinylShadeId(raw)) return raw;
  const mapped = PRESET_ID_TO_SHADE_ID[raw];
  if (mapped && isVinylShadeId(mapped)) return mapped;
  const preset = getPresetRegistry().get(raw);
  if (preset) {
    const byName = getVinylShades().find(
      (s) => s.name.toLowerCase() === preset.name.toLowerCase(),
    );
    if (byName) return byName.id;
  }
  return null;
}

function addonToGenrePreset(addon: RecordPlayerAddon): GenreVinylPreset {
  return {
    id: addon.id,
    name: addon.name,
    bucket: 'default',
    visualPreset: addon.visualPreset ?? {},
    cssVars: addon.cssVars,
    vinylClass: addon.vinylClass,
  };
}

function buildPresetRegistry(): Map<string, GenreVinylPreset> {
  const map = new Map<string, GenreVinylPreset>();
  for (const preset of Object.values(OFFICIAL_GENRE_PRESETS)) {
    map.set(preset.id, preset);
  }
  for (const addon of getOfficialPresets()) {
    if (!map.has(addon.id)) {
      map.set(addon.id, addonToGenrePreset(addon));
    }
  }
  return map;
}

let presetRegistry: Map<string, GenreVinylPreset> | null = null;

/** Lazy init avoids circular import with recordPlayerAddons ↔ vinylVisualSettings at boot. */
function getPresetRegistry(): Map<string, GenreVinylPreset> {
  if (!presetRegistry) {
    presetRegistry = buildPresetRegistry();
  }
  return presetRegistry;
}

/** All official Sandbox shades available in the genre mapping picker. */
export function getPickableGenreShades(): VinylShade[] {
  return getVinylShades();
}

/** @deprecated Use getPickableGenreShades — text preset picker removed. */
export function getPickableGenrePresets(): GenreVinylPreset[] {
  return getVinylShades().map((shade) => shadeToGenrePreset(shade, 'default'));
}

export function loadGenreOverrides(): Partial<Record<VinylGenreBucket, string>> {
  try {
    const raw = prefsGetItem(VINYL_GENRE_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const result: Partial<Record<VinylGenreBucket, string>> = {};
    for (const bucket of Object.keys(OFFICIAL_GENRE_PRESETS) as VinylGenreBucket[]) {
      const id = parsed[bucket];
      if (typeof id !== 'string') continue;
      const shadeId = normalizeOverrideToShadeId(id);
      if (shadeId) result[bucket] = shadeId;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveGenreOverride(bucket: VinylGenreBucket, shadeId: string): void {
  if (!isVinylShadeId(shadeId)) return;
  const overrides = { ...loadGenreOverrides(), [bucket]: shadeId };
  prefsSetItem(VINYL_GENRE_OVERRIDES_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function resolveGenreShade(bucket: VinylGenreBucket): VinylShade {
  const overrides = loadGenreOverrides();
  const shadeId = overrides[bucket] ?? GENRE_SHADE_MAP[bucket];
  return getVinylShadeById(shadeId) ?? getVinylShadeById(GENRE_SHADE_MAP[bucket])!;
}

export function resolveGenrePreset(bucket: VinylGenreBucket): GenreVinylPreset {
  return shadeToGenrePreset(resolveGenreShade(bucket), bucket);
}

const HIP_HOP_RE =
  /\b(hip[\s-]?hop|rap|trap|drill|grime|boom[\s-]?bap|gangsta|crunk|phonk)\b/i;
const ELECTRONIC_RE =
  /\b(electronic|edm|techno|house|trance|dubstep|dnb|drum[\s&]?bass|synth|ambient|idm|electro)\b/i;
const ROCK_RE =
  /\b(rock|metal|punk|grunge|alternative|indie[\s-]?rock|hardcore|post[\s-]?rock|shoegaze)\b/i;
const JAZZ_RE = /\b(jazz|bebop|swing|fusion|bossa|nu[\s-]?jazz|smooth[\s-]?jazz)\b/i;
const POP_RE = /\b(pop|dance[\s-]?pop|synthpop|k[\s-]?pop|j[\s-]?pop|top[\s-]?40)\b/i;
const RNB_RE =
  /\b(r[\s&]?b|rhythm[\s&]?blues|soul|neo[\s-]?soul|funk|motown|contemporary[\s-]?r[\s&]?b)\b/i;

export function normalizeGenreBucket(raw: string): VinylGenreBucket {
  const g = raw.trim();
  if (!g) return 'default';
  if (HIP_HOP_RE.test(g)) return 'hip-hop';
  if (ELECTRONIC_RE.test(g)) return 'electronic';
  if (ROCK_RE.test(g)) return 'rock';
  if (JAZZ_RE.test(g)) return 'jazz';
  if (POP_RE.test(g)) return 'pop';
  if (RNB_RE.test(g)) return 'rnb';
  return 'default';
}

function lockerGenreFromEnvelopeId(envelopeId: string): string {
  const match = /^local-(.+)$/.exec(envelopeId.trim());
  if (!match) return '';
  const entries = getLockerEntriesSnapshot() ?? [];
  const entry = entries.find((e) => e.id === match[1]);
  return entry?.genre?.trim() ?? '';
}

function tasteProfileGenreHint(_envelope: MediaEnvelope): string {
  try {
    const profile = getTasteProfile();
    const genreAffinity = profile.genreAffinity;
    const keys = Object.keys(genreAffinity);
    if (keys.length === 0) return '';
    const top = keys.sort((a, b) => (genreAffinity[b] ?? 0) - (genreAffinity[a] ?? 0))[0];
    return top ?? '';
  } catch {
    return '';
  }
}

/** Fallback chain: locker ID3 → envelope/locker match → taste profile → empty. */
export function resolveTrackGenre(envelope: MediaEnvelope | null | undefined): string {
  if (!envelope) return '';

  const fromId = lockerGenreFromEnvelopeId(envelope.envelopeId);
  if (fromId) return fromId;

  const fromMatch = resolveEnvelopeGenre(envelope);
  if (fromMatch) return fromMatch;

  const fromTaste = tasteProfileGenreHint(envelope);
  if (fromTaste) return fromTaste;

  return '';
}

export function getGenreBucketForTrack(
  envelope: MediaEnvelope | null | undefined,
): VinylGenreBucket {
  return normalizeGenreBucket(resolveTrackGenre(envelope));
}

export function getGenreVinylPreset(
  envelope: MediaEnvelope | null | undefined,
): GenreVinylPreset {
  const bucket = getGenreBucketForTrack(envelope);
  return resolveGenrePreset(bucket);
}

export function getGenreVinylPresetByBucket(bucket: VinylGenreBucket): GenreVinylPreset {
  return resolveGenrePreset(bucket);
}

function clamp0_100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Genre baseline + user sliders as fine-tune (50% of user value added on top). */
export function mergeGenrePresetWithUserSettings(
  user: VinylVisualSettings,
  preset: GenreVinylPreset,
): VinylVisualSettings {
  const base = preset.visualPreset;
  const keys = VINYL_VISUAL_KEYS;
  const result = { ...user };
  for (const key of keys) {
    const presetVal = base[key];
    if (presetVal === undefined) continue;
    result[key] = clamp0_100(Math.round(presetVal + user[key] * 0.5));
  }
  return result;
}
