/**
 * Sandbox skin presets — shared CSS token targets.
 * Brand orange (#C2410C) is Sandbox identity on every skin unless Custom CSS overrides it.
 * Focus accent (--accent-focus) is per-skin; brand (--accent-brand) stays constant.
 */

export const ACCENT_BRAND = '#C2410C';

export interface ThemeShellTokens {
  bgVoid: string;
  bgSurface: string;
  bgCard: string;
  bgHover: string;
  border: string;
  borderHi: string;
  textPrimary: string;
  textHeading: string;
  textMid: string;
  textLabel: string;
  textDim: string;
  bgInput: string;
  bgInputElevated: string;
  borderInput: string;
  accentFocus: string;
  accentBrand: string;
}

export interface ThemePresetConfig {
  toneKey: string;
  presetKey: string;
  descriptionKey: string;
  shell: ThemeShellTokens;
  focusH: number;
  focusS: string;
  focusL: string;
  focusHex: string;
  font: string;
  radius: string;
}

const focusHsl = (
  hex: string,
  h: number,
  s: string,
  l: string,
): Pick<ThemePresetConfig, 'focusH' | 'focusS' | 'focusL' | 'focusHex'> => ({
  focusH: h,
  focusS: s,
  focusL: l,
  focusHex: hex,
});

/** Focus (default) — dark void, brand-orange accents, warm purple ambient glow. */
const FOCUS_SHELL: ThemeShellTokens = {
  bgVoid: '#07080C',
  bgSurface: '#11141C',
  bgCard: '#1A1D26',
  bgHover: '#222632',
  border: '#2A2D38',
  borderHi: '#363A48',
  textPrimary: '#E8E4DF',
  textHeading: '#F5F2ED',
  textMid: '#9A958C',
  textLabel: '#8A857C',
  textDim: '#5C5850',
  bgInput: '#0D0F14',
  bgInputElevated: '#141820',
  borderInput: 'rgb(42 40 48 / 0.65)',
  accentFocus: ACCENT_BRAND,
  accentBrand: ACCENT_BRAND,
};

export const THEME_PRESETS: ThemePresetConfig[] = [
  {
    toneKey: 'Focus',
    presetKey: 'focus',
    descriptionKey: 'settings.architect.presets.focusDesc',
    shell: FOCUS_SHELL,
    ...focusHsl(ACCENT_BRAND, 21, '89%', '40%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    toneKey: 'Tactical Midnight',
    presetKey: 'tacticalMidnight',
    descriptionKey: 'settings.architect.presets.tacticalMidnightDesc',
    shell: {
      bgVoid: '#02050B',
      bgSurface: '#0B132B',
      bgCard: '#0F1A35',
      bgHover: '#152040',
      border: '#2A1810',
      borderHi: '#3D2818',
      textPrimary: '#E8E4DF',
      textHeading: '#F0EBE4',
      textMid: '#9AA3BC',
      textLabel: '#A8B0C8',
      textDim: '#6E758C',
      bgInput: '#0B132B',
      bgInputElevated: '#0F1A35',
      borderInput: 'rgb(42 24 16 / 0.55)',
      accentFocus: '#E8500A',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#E8500A', 23, '78%', '38%'),
    font: 'IBM Plex Mono',
    radius: '12px',
  },
  {
    toneKey: 'Light Canvas',
    presetKey: 'lightCanvas',
    descriptionKey: 'settings.architect.presets.lightCanvasDesc',
    shell: {
      bgVoid: '#E5E7EB',
      bgSurface: '#FFFFFF',
      bgCard: '#FFFFFF',
      bgHover: '#F3F4F6',
      border: '#D1D5DB',
      borderHi: '#9CA3AF',
      textPrimary: '#111827',
      textHeading: '#030712',
      textMid: '#4B5563',
      textLabel: '#6B7280',
      textDim: '#9CA3AF',
      bgInput: '#FFFFFF',
      bgInputElevated: '#F9FAFB',
      borderInput: 'rgb(156 163 175 / 0.55)',
      accentFocus: '#0A84FF',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#0A84FF', 211, '96%', '52%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    toneKey: 'HC Terminal',
    presetKey: 'hcTerminal',
    descriptionKey: 'settings.architect.presets.hcTerminalDesc',
    shell: {
      bgVoid: '#0A0A08',
      bgSurface: '#1C1F14',
      bgCard: '#232818',
      bgHover: '#2A2F1A',
      border: '#FFB020',
      borderHi: '#FF9F0A',
      textPrimary: '#F5F5DC',
      textHeading: '#FFFEF0',
      textMid: '#C4C4A8',
      textLabel: '#B8B89C',
      textDim: '#7A7A62',
      bgInput: '#141610',
      bgInputElevated: '#1C1F14',
      borderInput: 'rgb(255 176 32 / 0.35)',
      accentFocus: '#FFD700',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#FFD700', 51, '100%', '50%'),
    font: 'IBM Plex Mono',
    radius: '4px',
  },
  {
    toneKey: 'Deep Ocean',
    presetKey: 'deepOcean',
    descriptionKey: 'settings.architect.presets.deepOceanDesc',
    shell: {
      bgVoid: '#020B14',
      bgSurface: '#0F2A2E',
      bgCard: '#134E4A',
      bgHover: '#155E59',
      border: '#22D3EE',
      borderHi: '#06B6D4',
      textPrimary: '#E0F2FE',
      textHeading: '#F0F9FF',
      textMid: '#7DD3FC',
      textLabel: '#67C4E8',
      textDim: '#3B8FB8',
      bgInput: '#0A1F24',
      bgInputElevated: '#0F2A2E',
      borderInput: 'rgb(34 211 238 / 0.35)',
      accentFocus: '#0EA5E9',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#0EA5E9', 199, '89%', '48%'),
    font: 'Inter',
    radius: '16px',
  },
  {
    toneKey: 'Blood Moon',
    presetKey: 'bloodMoon',
    descriptionKey: 'settings.architect.presets.bloodMoonDesc',
    shell: {
      bgVoid: '#1A0508',
      bgSurface: '#2A0A10',
      bgCard: '#350F15',
      bgHover: '#451018',
      border: '#DC2626',
      borderHi: '#991B1B',
      textPrimary: '#FEE2E2',
      textHeading: '#FFF1F2',
      textMid: '#FCA5A5',
      textLabel: '#F87171',
      textDim: '#B91C1C',
      bgInput: '#1A0508',
      bgInputElevated: '#2A0A10',
      borderInput: 'rgb(220 38 38 / 0.4)',
      accentFocus: '#FF0000',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#FF0000', 0, '100%', '50%'),
    font: 'IBM Plex Mono',
    radius: '8px',
  },
];

/** Curated theme subset for mobile player-look sheet (desktop shows all). */
export const MOBILE_THEME_PRESET_KEYS = ['Focus', 'Tactical Midnight', 'Deep Ocean'] as const;

export function getMobileThemePresets(): ThemePresetConfig[] {
  const keys = new Set<string>(MOBILE_THEME_PRESET_KEYS);
  return THEME_PRESETS.filter((p) => keys.has(p.toneKey));
}

export const DEFAULT_THEME_TONE = 'Focus';

export const CUSTOM_THEME_TONES = new Set(['Custom CSS', 'Custom Override']);

export function getThemePreset(tone: string): ThemePresetConfig | undefined {
  return THEME_PRESETS.find((p) => p.toneKey === tone);
}

export function getBaseShellForTone(tone: string): ThemeShellTokens {
  if (CUSTOM_THEME_TONES.has(tone)) return FOCUS_SHELL;
  return getThemePreset(tone)?.shell ?? FOCUS_SHELL;
}

export function normalizeThemeTone(tone: string | null | undefined): string {
  if (!tone) return DEFAULT_THEME_TONE;
  if (tone === 'Blood Orange') return 'Blood Moon';
  if (tone === 'Custom Override') return 'Custom CSS';
  return tone;
}
