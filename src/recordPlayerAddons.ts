/**
 * Record-player visual addons — official Sandbox presets + user-installed community packs.
 * Safe sandbox: no JS execution; only whitelisted CSS vars and vinyl-addon-* classes.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { detectTVPlatform } from './tvDetection';
import { isNativePhoneShell } from './musicUniverse';
import type { VinylVisualSettings } from './vinylVisualSettings';
import { DEFAULT_VINYL_VISUAL_SETTINGS } from './vinylVisualSettings';

export const RECORD_PLAYER_ADDONS_KEY = 'sandbox_record_player_addons_v1';
export const ACTIVE_RECORD_PLAYER_ADDON_KEY = 'sandbox_active_record_player_addon_v1';
export const RECORD_PLAYER_CATALOG_URL = '/addons/record-player/manifest.json';

export interface RecordPlayerAddon {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  preview?: string;
  /** Official Sandbox preset — not a community pack. */
  official?: boolean;
  /** @deprecated Use official instead */
  builtIn?: boolean;
  manifestUrl?: string;
  visualPreset?: Partial<VinylVisualSettings>;
  cssVars?: Record<string, string>;
  vinylClass?: string;
  deviceHints?: { desktop?: boolean; tv?: boolean; mobile?: boolean };
}

export interface RecordPlayerCatalogEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  preview?: string;
  downloadUrl: string;
}

export interface RecordPlayerCatalog {
  version: string;
  updated: string;
  packs: RecordPlayerCatalogEntry[];
}

const ALLOWED_VINYL_CSS_VARS = new Set([
  '--vinyl-psyche-intensity',
  '--vinyl-color-throw',
  '--vinyl-pulse',
  '--vinyl-hue-drift',
  '--vinyl-spin-trail',
  '--vinyl-warp',
  '--vinyl-pulse-duration',
  '--vinyl-hue-duration',
  '--vinyl-animation-speed',
  '--vinyl-addon-glow',
  '--vinyl-addon-tint',
  '--vinyl-addon-warmth',
]);

const VINYL_CLASS_RE = /^vinyl-addon-[a-z0-9-]+$/;

const OFFICIAL_AUTHOR = 'Sandbox Music';

function clamp0_100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const OFFICIAL_PRESET_IDS = {
  classicVoid: 'classic-void',
  neonTrip: 'neon-trip',
  vinylWarmth: 'vinyl-warmth',
  tvHypnosis: 'tv-hypnosis',
} as const;

/** @deprecated Use OFFICIAL_PRESET_IDS */
export const BUILTIN_RECORD_PLAYER_ADDON_IDS = OFFICIAL_PRESET_IDS;

const OFFICIAL_ID_SET = new Set<string>(Object.values(OFFICIAL_PRESET_IDS));

export function isOfficialPresetId(id: string): boolean {
  return OFFICIAL_ID_SET.has(id);
}

function officialClassicVoid(): RecordPlayerAddon {
  return {
    id: OFFICIAL_PRESET_IDS.classicVoid,
    name: 'Classic Void',
    author: OFFICIAL_AUTHOR,
    description: 'Subtle out-of-box glow — pair with sliders for your own trip.',
    version: '1.0.0',
    preview: '🌑',
    official: true,
    builtIn: true,
    visualPreset: DEFAULT_VINYL_VISUAL_SETTINGS,
    deviceHints: { desktop: true, tv: true, mobile: true },
  };
}

function officialNeonTrip(): RecordPlayerAddon {
  return {
    id: OFFICIAL_PRESET_IDS.neonTrip,
    name: 'Neon Trip',
    author: OFFICIAL_AUTHOR,
    description: 'Electric streaks and hue drift — neon electronic energy.',
    version: '1.0.0',
    preview: 'linear-gradient(135deg, #ff00ff, #00ffff)',
    official: true,
    builtIn: true,
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
    deviceHints: { desktop: true, tv: true, mobile: false },
  };
}

function officialVinylWarmth(): RecordPlayerAddon {
  return {
    id: OFFICIAL_PRESET_IDS.vinylWarmth,
    name: 'Vinyl Warmth',
    author: OFFICIAL_AUTHOR,
    description: 'Amber lamp glow and soft pulse — feels like a listening room.',
    version: '1.0.0',
    preview: 'linear-gradient(135deg, #c45c26, #f0c080)',
    official: true,
    builtIn: true,
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
    deviceHints: { desktop: true, tv: true, mobile: true },
  };
}

function officialTvHypnosis(): RecordPlayerAddon {
  return {
    id: OFFICIAL_PRESET_IDS.tvHypnosis,
    name: 'TV Hypnosis',
    author: OFFICIAL_AUTHOR,
    description: 'Slow rings and gentle drift — made for couch leanback screens.',
    version: '1.0.0',
    preview: '📺',
    official: true,
    builtIn: true,
    visualPreset: {
      universeIntensity: 40,
      colorThrow: 50,
      pulse: 25,
      hueDrift: 35,
      spinTrail: 30,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-glow': '0.5' },
    vinylClass: 'vinyl-addon-tv-hypnosis',
    deviceHints: { desktop: false, tv: true, mobile: false },
  };
}

export function getOfficialPresets(): RecordPlayerAddon[] {
  return [officialClassicVoid(), officialNeonTrip(), officialVinylWarmth(), officialTvHypnosis()];
}

/** @deprecated Use getOfficialPresets */
export function builtinRecordPlayerPack(): RecordPlayerAddon[] {
  return getOfficialPresets();
}

function readInstalledRaw(): RecordPlayerAddon[] {
  try {
    const raw = prefsGetItem(RECORD_PLAYER_ADDONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecordPlayerAddon[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeInstalledRaw(addons: RecordPlayerAddon[]): void {
  prefsSetItem(RECORD_PLAYER_ADDONS_KEY, JSON.stringify(addons));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** User-installed community packs only — excludes official presets. */
export function loadInstalledCommunityPacks(): RecordPlayerAddon[] {
  return readInstalledRaw().filter((a) => !isOfficialPresetId(a.id) && !a.official);
}

/** Remove legacy official presets mistakenly stored as installed packs. */
export function migrateLegacyInstalledPacks(): void {
  const existing = readInstalledRaw();
  const filtered = existing.filter((a) => !isOfficialPresetId(a.id) && !a.official);
  if (filtered.length !== existing.length) {
    writeInstalledRaw(filtered);
  }
}

/** @deprecated Use migrateLegacyInstalledPacks */
export function ensureBuiltinRecordPlayerAddons(): void {
  migrateLegacyInstalledPacks();
}

export function sanitizeCssVars(
  cssVars: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!cssVars) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cssVars)) {
    if (!ALLOWED_VINYL_CSS_VARS.has(key)) continue;
    const trimmed = String(value).trim().slice(0, 64);
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeVinylClass(vinylClass: string | undefined): string | undefined {
  if (!vinylClass) return undefined;
  const trimmed = vinylClass.trim();
  return VINYL_CLASS_RE.test(trimmed) ? trimmed : undefined;
}

export function sanitizeVisualPreset(
  preset: Partial<VinylVisualSettings> | undefined,
): Partial<VinylVisualSettings> | undefined {
  if (!preset) return undefined;
  const out: Partial<VinylVisualSettings> = {};
  const keys = Object.keys(DEFAULT_VINYL_VISUAL_SETTINGS) as (keyof VinylVisualSettings)[];
  for (const key of keys) {
    const v = preset[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = clamp0_100(v);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function validateRecordPlayerAddon(raw: unknown): RecordPlayerAddon {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Addon must be a JSON object.');
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const author = typeof o.author === 'string' ? o.author.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  const version = typeof o.version === 'string' ? o.version.trim() : '';

  if (!id || id.length > 64) throw new Error('Addon id is required (max 64 chars).');
  if (!name || name.length > 80) throw new Error('Addon name is required.');
  if (!author || author.length > 80) throw new Error('Addon author is required.');
  if (!description || description.length > 400) throw new Error('Addon description is required.');
  if (!version || version.length > 24) throw new Error('Addon version is required.');
  if (isOfficialPresetId(id)) {
    throw new Error('This id is reserved for an official Sandbox preset.');
  }

  const deviceHints =
    o.deviceHints && typeof o.deviceHints === 'object'
      ? {
          desktop: (o.deviceHints as { desktop?: boolean }).desktop,
          tv: (o.deviceHints as { tv?: boolean }).tv,
          mobile: (o.deviceHints as { mobile?: boolean }).mobile,
        }
      : undefined;

  return {
    id,
    name,
    author,
    description,
    version,
    preview: typeof o.preview === 'string' ? o.preview.trim().slice(0, 120) : undefined,
    official: false,
    builtIn: false,
    manifestUrl: typeof o.manifestUrl === 'string' ? o.manifestUrl.trim() : undefined,
    visualPreset: sanitizeVisualPreset(o.visualPreset as Partial<VinylVisualSettings> | undefined),
    cssVars: sanitizeCssVars(o.cssVars as Record<string, string> | undefined),
    vinylClass: sanitizeVinylClass(typeof o.vinylClass === 'string' ? o.vinylClass : undefined),
    deviceHints,
  };
}

/** All addons: official presets + installed community (legacy). */
export function loadRecordPlayerAddons(): RecordPlayerAddon[] {
  migrateLegacyInstalledPacks();
  return [...getOfficialPresets(), ...loadInstalledCommunityPacks()];
}

export function getRecordPlayerAddonById(id: string): RecordPlayerAddon | null {
  const official = getOfficialPresets().find((a) => a.id === id);
  if (official) return official;
  return loadInstalledCommunityPacks().find((a) => a.id === id) ?? null;
}

export function loadActiveRecordPlayerAddonId(): string {
  const raw = prefsGetItem(ACTIVE_RECORD_PLAYER_ADDON_KEY);
  if (raw) return raw;
  return OFFICIAL_PRESET_IDS.classicVoid;
}

export function saveActiveRecordPlayerAddonId(id: string): void {
  prefsSetItem(ACTIVE_RECORD_PLAYER_ADDON_KEY, id);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function installRecordPlayerAddon(addon: RecordPlayerAddon): RecordPlayerAddon {
  const validated = validateRecordPlayerAddon(addon);
  const community = loadInstalledCommunityPacks();
  const entry: RecordPlayerAddon = { ...validated, official: false, builtIn: false };
  const next = [...community.filter((a) => a.id !== entry.id), entry];
  writeInstalledRaw(next);
  return entry;
}

export function removeRecordPlayerAddon(id: string): void {
  if (isOfficialPresetId(id)) return;
  const list = loadInstalledCommunityPacks();
  const target = list.find((a) => a.id === id);
  if (!target) return;
  writeInstalledRaw(list.filter((a) => a.id !== id));
  if (loadActiveRecordPlayerAddonId() === id) {
    saveActiveRecordPlayerAddonId(OFFICIAL_PRESET_IDS.classicVoid);
  }
}

export function getCurrentDeviceHint(): 'desktop' | 'tv' | 'mobile' {
  if (detectTVPlatform()) return 'tv';
  if (isNativePhoneShell()) return 'mobile';
  return 'desktop';
}

export function isAddonSupportedOnDevice(addon: RecordPlayerAddon): boolean {
  const hints = addon.deviceHints;
  if (!hints) return true;
  const device = getCurrentDeviceHint();
  if (device === 'tv' && hints.tv === false) return false;
  if (device === 'mobile' && hints.mobile === false) return false;
  if (device === 'desktop' && hints.desktop === false) return false;
  return true;
}

export function getActiveRecordPlayerAddon(): RecordPlayerAddon {
  const id = loadActiveRecordPlayerAddonId();
  const addon = getRecordPlayerAddonById(id);
  if (addon && isAddonSupportedOnDevice(addon)) return addon;
  return getRecordPlayerAddonById(OFFICIAL_PRESET_IDS.classicVoid) ?? officialClassicVoid();
}

/** Addon baseline + user sliders as fine-tune (50% of user value added on top). */
export function mergeAddonWithUserSettings(
  user: VinylVisualSettings,
  addon: RecordPlayerAddon | null,
): VinylVisualSettings {
  if (!addon?.visualPreset) return user;
  const preset = addon.visualPreset;
  const keys = Object.keys(DEFAULT_VINYL_VISUAL_SETTINGS) as (keyof VinylVisualSettings)[];
  const result = { ...user };
  for (const key of keys) {
    const base = preset[key];
    if (base === undefined) continue;
    result[key] = clamp0_100(Math.round(base + user[key] * 0.5));
  }
  return result;
}

export async function fetchRecordPlayerCatalog(
  url = RECORD_PLAYER_CATALOG_URL,
): Promise<RecordPlayerCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalog fetch failed (${res.status}).`);
  const data = (await res.json()) as RecordPlayerCatalog;
  if (!data?.packs || !Array.isArray(data.packs)) {
    throw new Error('Invalid catalog format.');
  }
  return data;
}

export async function installRecordPlayerAddonFromUrl(url: string): Promise<RecordPlayerAddon> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
    if (parsedUrl.protocol !== 'https:' && !url.startsWith('/')) {
      throw new Error('bad protocol');
    }
  } catch {
    throw new Error('Enter a valid HTTPS manifest URL.');
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Manifest fetch failed (${res.status}).`);
  const raw = await res.json();
  const addon = validateRecordPlayerAddon(raw);
  return installRecordPlayerAddon({ ...addon, manifestUrl: url });
}

export function importRecordPlayerAddonJson(raw: string): RecordPlayerAddon {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON — paste a valid record-player addon manifest.');
  }
  return installRecordPlayerAddon(validateRecordPlayerAddon(parsed));
}
