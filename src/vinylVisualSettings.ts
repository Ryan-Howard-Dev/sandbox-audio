import { useEffect, useMemo, useState } from 'react';
import type { MediaEnvelope } from './sandboxLayer1';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  applyVinylVisualCaps,
  type EffectiveVinylVisuals,
} from './vinylVisualCapabilities';
import {
  getActiveRecordPlayerAddon,
  sanitizeCssVars,
  type RecordPlayerAddon,
} from './recordPlayerAddons';
import { loadVinylDisplayMode } from './vinylDisplaySettings';
import {
  getGenreVinylPreset,
  mergeGenrePresetWithUserSettings,
  type GenreVinylPreset,
} from './vinylGenreThemes';
import { ACCENT_BRAND } from './themePresets';

export const VINYL_VISUAL_SETTINGS_KEY = 'sandbox_vinyl_visual_settings_v1';

export interface VinylVisualSettings {
  universeIntensity: number;
  colorThrow: number;
  pulse: number;
  hueDrift: number;
  spinTrail: number;
  warp: number;
  /** 0–100: mix title-seed colors with sampled album art (100 = full art). */
  artBlend: number;
}

export const DEFAULT_VINYL_VISUAL_SETTINGS: VinylVisualSettings = {
  universeIntensity: 0,
  colorThrow: 0,
  pulse: 0,
  hueDrift: 0,
  spinTrail: 0,
  warp: 0,
  artBlend: 0,
};

/**
 * Vinyl disc tint — stored separately from the numeric visual settings (which are used in
 * arithmetic / capping). '' = classic black vinyl; default = brand orange.
 */
export const VINYL_DISC_COLOR_KEY = 'sandbox_vinyl_disc_color_v1';

/** Default vinyl disc tint — Sandbox brand dark orange. */
export const DEFAULT_VINYL_DISC_COLOR = ACCENT_BRAND;

export const VINYL_DISC_COLORS: { id: string; label: string; value: string }[] = [
  { id: 'sandbox', label: 'Sandbox orange', value: DEFAULT_VINYL_DISC_COLOR },
  { id: 'classic', label: 'Classic black', value: '' },
  { id: 'crimson', label: 'Crimson', value: '#e23b4e' },
  { id: 'amber', label: 'Amber', value: '#e8870a' },
  { id: 'gold', label: 'Gold', value: '#d8b14a' },
  { id: 'emerald', label: 'Emerald', value: '#2faf72' },
  { id: 'teal', label: 'Teal', value: '#2bb7c4' },
  { id: 'azure', label: 'Azure', value: '#3a7be8' },
];

const SAFE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const LEGACY_DISC_COLORS = new Set(['#8b5cf6', '#d846a8', '#e23b4e']);

export function loadVinylDiscColor(): string {
  try {
    const raw = prefsGetItem(VINYL_DISC_COLOR_KEY);
    if (raw === null) return DEFAULT_VINYL_DISC_COLOR;
    const trimmed = raw.trim();
    if (trimmed === '') return '';
    if (SAFE_HEX.test(trimmed)) {
      if (LEGACY_DISC_COLORS.has(trimmed.toLowerCase())) {
        saveVinylDiscColor(DEFAULT_VINYL_DISC_COLOR);
        return DEFAULT_VINYL_DISC_COLOR;
      }
      return trimmed;
    }
    return DEFAULT_VINYL_DISC_COLOR;
  } catch {
    return DEFAULT_VINYL_DISC_COLOR;
  }
}

export function saveVinylDiscColor(color: string): void {
  const trimmed = color.trim();
  const safe =
    trimmed === '' ? '' : SAFE_HEX.test(trimmed) ? trimmed : DEFAULT_VINYL_DISC_COLOR;
  prefsSetItem(VINYL_DISC_COLOR_KEY, safe);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export const VINYL_VISUAL_PRESETS = {
  subtle: DEFAULT_VINYL_VISUAL_SETTINGS,
  trip: {
    universeIntensity: 45,
    colorThrow: 55,
    pulse: 40,
    hueDrift: 35,
    spinTrail: 30,
    warp: 20,
    artBlend: 0,
  },
  dmt: {
    universeIntensity: 85,
    colorThrow: 90,
    pulse: 75,
    hueDrift: 80,
    spinTrail: 70,
    warp: 60,
    artBlend: 0,
  },
} satisfies Record<string, VinylVisualSettings>;

/** Mobile sheet presets — capped-friendly; Trip/DMT stay desktop-only. */
export const MOBILE_VINYL_VISUAL_PRESETS = {
  subtle: DEFAULT_VINYL_VISUAL_SETTINGS,
  glow: {
    universeIntensity: 35,
    colorThrow: 40,
    pulse: 30,
    hueDrift: 25,
    spinTrail: 15,
    warp: 0,
    artBlend: 0,
  },
} satisfies Record<string, VinylVisualSettings>;

export type MobileVinylVisualPresetId = keyof typeof MOBILE_VINYL_VISUAL_PRESETS;

function clamp0_100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function loadVinylVisualSettings(): VinylVisualSettings {
  try {
    const raw = prefsGetItem(VINYL_VISUAL_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VINYL_VISUAL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VinylVisualSettings>;
    return {
      universeIntensity: clamp0_100(parsed.universeIntensity ?? 0),
      colorThrow: clamp0_100(parsed.colorThrow ?? 0),
      pulse: clamp0_100(parsed.pulse ?? 0),
      hueDrift: clamp0_100(parsed.hueDrift ?? 0),
      spinTrail: clamp0_100(parsed.spinTrail ?? 0),
      warp: clamp0_100(parsed.warp ?? 0),
      artBlend: clamp0_100(parsed.artBlend ?? 0),
    };
  } catch {
    return { ...DEFAULT_VINYL_VISUAL_SETTINGS };
  }
}

export function saveVinylVisualSettings(settings: VinylVisualSettings): void {
  prefsSetItem(VINYL_VISUAL_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function vinylVisualSettingsToCss(
  effective: EffectiveVinylVisuals,
): Record<string, string> {
  const master = effective.universeIntensity / 100;
  const speed = effective.animationSpeedMul <= 0 ? 1 : effective.animationSpeedMul;
  const pulseDur = Math.max(4, (18 - effective.pulse * 0.12) / speed);
  const hueDur = Math.max(6, (24 - effective.hueDrift * 0.16) / speed);

  return {
    '--vinyl-psyche-intensity': String(master),
    '--vinyl-color-throw': String((effective.colorThrow / 100) * master),
    '--vinyl-pulse': String((effective.pulse / 100) * master),
    '--vinyl-hue-drift': String((effective.hueDrift / 100) * master),
    '--vinyl-spin-trail': String((effective.spinTrail / 100) * master),
    '--vinyl-warp': String((effective.warp / 100) * master),
    '--vinyl-pulse-duration': `${pulseDur}s`,
    '--vinyl-hue-duration': `${hueDur}s`,
    '--vinyl-animation-speed': String(speed),
  };
}

export function buildVinylPsycheClass(effective: EffectiveVinylVisuals): string {
  const classes: string[] = [];
  if (effective.universeIntensity <= 0) return '';

  classes.push('vinyl-psyche-active');
  if (effective.colorThrow >= 8 && effective.enableStreaks) {
    classes.push('vinyl-psyche-throw');
  }
  if (effective.colorThrow >= 15 && effective.enableRings) {
    classes.push('vinyl-psyche-rings');
  }
  if (effective.pulse > 0) classes.push('vinyl-psyche-pulse');
  if (effective.hueDrift > 0) classes.push('vinyl-psyche-hue');
  if (effective.spinTrail > 0) classes.push('vinyl-psyche-trail');
  if (effective.warp > 0) classes.push('vinyl-psyche-warp');
  return classes.join(' ');
}

export function useVinylVisualStyle(envelope?: MediaEnvelope | null): {
  settings: VinylVisualSettings;
  effective: EffectiveVinylVisuals;
  cssVars: Record<string, string>;
  psycheClass: string;
  vinylClass: string;
  activeAddon: RecordPlayerAddon | null;
  genrePreset: GenreVinylPreset | null;
  displayMode: 'manual' | 'follow-genre' | 'follow-art';
} {
  const [settings, setSettings] = useState(loadVinylVisualSettings);
  const [activeAddon, setActiveAddon] = useState(getActiveRecordPlayerAddon);
  const [displayMode, setDisplayMode] = useState(loadVinylDisplayMode);
  const [discColor, setDiscColor] = useState(loadVinylDiscColor);

  useEffect(() => {
    const sync = () => {
      setSettings(loadVinylVisualSettings());
      setActiveAddon(getActiveRecordPlayerAddon());
      setDisplayMode(loadVinylDisplayMode());
      setDiscColor(loadVinylDiscColor());
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  const followGenre = displayMode === 'follow-genre';
  const genrePreset = useMemo(
    () => (followGenre ? getGenreVinylPreset(envelope) : null),
    [followGenre, envelope?.envelopeId, envelope?.title, envelope?.artist],
  );

  const mergedSettings = useMemo(() => {
    if (followGenre && genrePreset) {
      return mergeGenrePresetWithUserSettings(settings, genrePreset);
    }
    // Manual mode — user sliders/presets are authoritative; addons supply cssVars + class only.
    return settings;
  }, [settings, followGenre, genrePreset]);

  const effective = useMemo(() => applyVinylVisualCaps(mergedSettings), [mergedSettings]);

  const styleSource = followGenre ? genrePreset : activeAddon;

  const cssVars = useMemo(() => {
    const base = vinylVisualSettingsToCss(effective);
    const addonVars = sanitizeCssVars(styleSource?.cssVars);
    const merged = addonVars ? { ...base, ...addonVars } : { ...base };
    const tint =
      discColor === '' ? '' : discColor || DEFAULT_VINYL_DISC_COLOR;
    if (tint) {
      merged['--vinyl-disc-tint'] = tint;
    }
    return merged;
  }, [effective, styleSource, discColor]);

  const psycheClass = useMemo(() => buildVinylPsycheClass(effective), [effective]);
  const vinylClass = useMemo(() => {
    const vinylAddonClass =
      styleSource && 'vinylClass' in styleSource ? styleSource.vinylClass : undefined;
    const parts = [psycheClass, vinylAddonClass].filter(Boolean);
    return parts.join(' ');
  }, [psycheClass, styleSource]);

  return {
    settings,
    effective,
    cssVars,
    psycheClass,
    vinylClass,
    activeAddon: followGenre ? null : activeAddon,
    genrePreset,
    displayMode,
  };
}
