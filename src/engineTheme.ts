/**
 * Dynamic theme engine — shell tokens, focus accent, and brand orange.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  ACCENT_BRAND,
  CUSTOM_THEME_TONES,
  DEFAULT_THEME_TONE,
  getBaseShellForTone,
  getThemePreset,
  normalizeThemeTone,
  type ThemeShellTokens,
} from './themePresets';

export type IntensityId = 'neutral' | 'soft' | 'bright' | 'bold';

/** Tactical Midnight legacy focus — burnt amber-orange. */
export const DEFAULT_ACCENT_H = 23;
export const DEFAULT_ACCENT_S = '78%';
export const DEFAULT_ACCENT_L = '38%';
export const TACTICAL_MIDNIGHT_HEX = '#e8500a';

/** Focus skin default — brand orange. */
export const FOCUS_ACCENT_HEX = ACCENT_BRAND;
export const FOCUS_ACCENT_H = 21;
export const FOCUS_ACCENT_S = '89%';
export const FOCUS_ACCENT_L = '40%';

/** Focus ambient shell glow — warm orange, matches brand vinyl. */
export const FOCUS_SHELL_GLOW_A = 'hsl(21 55% 28% / 0.14)';
export const FOCUS_SHELL_GLOW_B = 'hsl(18 40% 20% / 0.08)';
export const FOCUS_SHELL_GRID = 'hsl(21 30% 20% / 0.04)';

/** Blood Moon — vivid red focus. */
export const BLOOD_MOON_H = 0;
export const BLOOD_MOON_S = '100%';
export const BLOOD_MOON_L = '50%';
export const BLOOD_MOON_HEX = '#FF0000';

const THEME_TONE_KEY = 'sandbox_theme_tone';
const ACCENT_HEX_KEY = 'sandbox_accent_hex';
const STORAGE_KEY = 'sandbox_engine_theme_v1';

export const INTENSITY_PRESETS: Record<
  IntensityId,
  { label: string; s: string; l: string }
> = {
  neutral: { label: 'Neutral', s: '32%', l: '48%' },
  soft: { label: 'Soft', s: '52%', l: '44%' },
  bright: { label: 'Burnt', s: '78%', l: '38%' },
  bold: { label: 'Deep burnt', s: '82%', l: '32%' },
};

export interface EngineThemeState {
  h: number;
  s: string;
  l: string;
  intensity: IntensityId;
}

function parsePercent(value: string): number {
  return parseInt(value.replace('%', ''), 10) || 0;
}

function applyShellTokens(shell: ThemeShellTokens): void {
  const root = document.documentElement;
  root.style.setProperty('--bg-void', shell.bgVoid);
  root.style.setProperty('--bg-surface', shell.bgSurface);
  root.style.setProperty('--bg-card', shell.bgCard);
  root.style.setProperty('--bg-hover', shell.bgHover);
  root.style.setProperty('--border', shell.border);
  root.style.setProperty('--border-hi', shell.borderHi);
  root.style.setProperty('--text-primary', shell.textPrimary);
  root.style.setProperty('--text-heading', shell.textHeading);
  root.style.setProperty('--text', shell.textPrimary);
  root.style.setProperty('--text-mid', shell.textMid);
  root.style.setProperty('--text-label', shell.textLabel);
  root.style.setProperty('--text-dim', shell.textDim);
  root.style.setProperty('--bg-input', shell.bgInput);
  root.style.setProperty('--bg-input-elevated', shell.bgInputElevated);
  root.style.setProperty('--border-input', shell.borderInput);
  root.style.setProperty('--accent-brand', shell.accentBrand);
  root.style.setProperty('--accent-focus', shell.accentFocus);
  root.style.setProperty('--input-focus', shell.accentFocus);
}

export function resolveThemeTone(): string {
  const raw = prefsGetItem(THEME_TONE_KEY);
  const tone = normalizeThemeTone(raw ?? DEFAULT_THEME_TONE);
  if (raw === 'Blood Orange') {
    prefsSetItem(THEME_TONE_KEY, 'Blood Moon');
  } else if (raw === 'Custom Override') {
    prefsSetItem(THEME_TONE_KEY, 'Custom CSS');
  }
  return tone;
}

export function applyThemeShell(tone?: string): void {
  const t = tone ?? resolveThemeTone();
  applyShellTokens(getBaseShellForTone(t));
}

/** Older saves used neon orange (90% / 45%) — nudge non-custom presets only. */
function normalizeToBurntPalette(state: EngineThemeState): EngineThemeState {
  const tone = resolveThemeTone();
  if (
    tone === 'Blood Moon' ||
    tone === 'HC Terminal' ||
    tone === 'Deep Ocean' ||
    tone === 'Focus' ||
    tone === 'Light Canvas' ||
    CUSTOM_THEME_TONES.has(tone)
  ) {
    return state;
  }
  const s = parsePercent(state.s);
  const l = parsePercent(state.l);
  if (s >= 86 && l >= 42) {
    return {
      ...state,
      s: DEFAULT_ACCENT_S,
      l: DEFAULT_ACCENT_L,
      intensity: 'bright',
    };
  }
  return state;
}

/** Upgrade old dull blood-orange attempts to vivid Blood Moon. */
function migrateBloodMoonTheme(state: EngineThemeState): EngineThemeState {
  const tone = resolveThemeTone();
  if (tone !== 'Blood Moon') return state;

  const l = parsePercent(state.l);
  const dull =
    state.h === 0 ||
    (state.h >= 8 && state.h <= 20 && l < 52) ||
    parsePercent(state.s) < 85;

  if (!dull) return state;

  prefsSetItem(ACCENT_HEX_KEY, BLOOD_MOON_HEX);
  return {
    h: BLOOD_MOON_H,
    s: BLOOD_MOON_S,
    l: BLOOD_MOON_L,
    intensity: 'bright',
  };
}

function defaultEngineStateForTone(tone: string): EngineThemeState {
  const preset = getThemePreset(tone);
  if (preset) {
    return {
      h: preset.focusH,
      s: preset.focusS,
      l: preset.focusL,
      intensity: 'bright',
    };
  }
  if (CUSTOM_THEME_TONES.has(tone)) {
    return {
      h: FOCUS_ACCENT_H,
      s: FOCUS_ACCENT_S,
      l: FOCUS_ACCENT_L,
      intensity: 'bright',
    };
  }
  return {
    h: FOCUS_ACCENT_H,
    s: FOCUS_ACCENT_S,
    l: FOCUS_ACCENT_L,
    intensity: 'bright',
  };
}

export function applyEngineTheme(h: number, s: string, l: string): void {
  const tone = resolveThemeTone();
  const preset = getThemePreset(tone);
  const isCustom = CUSTOM_THEME_TONES.has(tone);
  const vivid = tone === 'Blood Moon';
  const accentH = !isCustom && preset ? preset.focusH : h;
  const accentS = !isCustom && preset ? preset.focusS : s;
  const accentL = !isCustom && preset ? preset.focusL : l;
  const root = document.documentElement;
  root.style.setProperty('--accent-h', String(accentH));
  root.style.setProperty('--accent-s', accentS);
  root.style.setProperty('--accent-l', accentL);
  const focusStroke = `hsl(${accentH}, ${accentS}, ${accentL})`;
  const brand = preset?.shell.accentBrand ?? ACCENT_BRAND;
  const focusColor = isCustom ? focusStroke : (preset?.shell.accentFocus ?? focusStroke);
  root.style.setProperty('--accent-brand', brand);
  root.style.setProperty('--accent-focus', focusColor);
  root.style.setProperty('--input-focus', focusColor);
  root.style.setProperty('--orange', focusColor);
  root.style.setProperty('--accent-stroke', focusColor);
  const useFocusAmbient = tone === 'Focus';
  root.style.setProperty(
    '--shell-glow-a',
    useFocusAmbient
      ? FOCUS_SHELL_GLOW_A
      : vivid
        ? `hsl(${accentH} ${accentS} ${accentL} / 0.22)`
        : `hsl(${accentH} ${accentS} ${accentL} / 0.14)`,
  );
  root.style.setProperty(
    '--shell-glow-b',
    useFocusAmbient
      ? FOCUS_SHELL_GLOW_B
      : vivid
        ? `hsl(${accentH} ${accentS} ${accentL} / 0.1)`
        : `hsl(${accentH} ${accentS} ${accentL} / 0.06)`,
  );
  root.style.setProperty(
    '--shell-grid',
    useFocusAmbient ? FOCUS_SHELL_GRID : `hsl(${accentH} ${accentS} ${accentL} / 0.04)`,
  );
  window.dispatchEvent(new Event('sandbox-theme-change'));
}

export function loadEngineTheme(): EngineThemeState {
  try {
    const raw = prefsGetItem(STORAGE_KEY);
    if (!raw) {
      return defaultEngineStateForTone(resolveThemeTone());
    }
    const parsed = JSON.parse(raw) as EngineThemeState;
    const normalized = normalizeToBurntPalette({
      h: typeof parsed.h === 'number' ? parsed.h : FOCUS_ACCENT_H,
      s: parsed.s ?? FOCUS_ACCENT_S,
      l: parsed.l ?? FOCUS_ACCENT_L,
      intensity: parsed.intensity ?? 'bright',
    });
    return migrateBloodMoonTheme(normalized);
  } catch {
    return defaultEngineStateForTone(resolveThemeTone());
  }
}

export function saveEngineTheme(state: EngineThemeState): void {
  prefsSetItem(STORAGE_KEY, JSON.stringify(state));
  applyEngineTheme(state.h, state.s, state.l);
}

export function applyThemePreset(
  tone: string,
  accent: { h: number; s: string; l: string; hex: string },
): EngineThemeState {
  const normalizedTone = normalizeThemeTone(tone);
  prefsSetItem(THEME_TONE_KEY, normalizedTone);
  prefsSetItem(ACCENT_HEX_KEY, accent.hex);
  const state: EngineThemeState = {
    h: accent.h,
    s: accent.s,
    l: accent.l,
    intensity: 'bright',
  };
  saveEngineTheme(state);
  applyThemeShell(normalizedTone);
  window.dispatchEvent(new Event('sandbox-theme-change'));
  return state;
}

export function initEngineTheme(): EngineThemeState {
  let prior: EngineThemeState | null = null;
  try {
    const raw = prefsGetItem(STORAGE_KEY);
    if (raw) prior = JSON.parse(raw) as EngineThemeState;
  } catch {
    /* ignore */
  }
  const state = loadEngineTheme();
  applyThemeShell();
  applyEngineTheme(state.h, state.s, state.l);
  const migrated = prior ? migrateBloodMoonTheme(prior) : null;
  const shouldPersist =
    (prior && parsePercent(prior.s) >= 86 && parsePercent(prior.l) >= 42) ||
    (migrated &&
      (migrated.h !== prior!.h ||
        migrated.s !== prior!.s ||
        migrated.l !== prior!.l));
  if (shouldPersist) {
    saveEngineTheme(state);
  }
  return state;
}
