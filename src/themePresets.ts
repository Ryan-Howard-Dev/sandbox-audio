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
  textPrimary: '#D9D4CD',
  textHeading: '#E6E1D9',
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
      textPrimary: '#D7D2CB',
      textHeading: '#E3DDD4',
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
      textPrimary: '#1F2937',
      textHeading: '#111827',
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
      /* Deliberately left near-white: HC Terminal is the high-contrast option, so softening its
         text the way every other preset was softened would defeat the point of it. */
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
      textPrimary: '#CBE4F5',
      textHeading: '#DCEDFA',
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
      textPrimary: '#EFCFCF',
      textHeading: '#F5DEDE',
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
  /*
   * Low-glare family. Every preset above pairs a near-black shell with text at ~#E8E4DF or
   * brighter, which is 15:1+ contrast — technically excellent, but harsh on an OLED panel in a
   * dark room. These lift the background off pure black and drop the text luminance so contrast
   * lands nearer 9-11:1: still comfortably past WCAG AA, considerably easier to sit with.
   */
  {
    toneKey: 'Ember',
    presetKey: 'ember',
    descriptionKey: 'settings.architect.presets.emberDesc',
    shell: {
      bgVoid: '#12100E',
      bgSurface: '#1A1714',
      bgCard: '#221E1A',
      bgHover: '#2B2621',
      border: '#332C26',
      borderHi: '#41382F',
      textPrimary: '#D8D0C6',
      textHeading: '#E4DCD1',
      textMid: '#9A8F82',
      textLabel: '#8A7F72',
      textDim: '#6B6157',
      bgInput: '#17140F',
      bgInputElevated: '#1F1A15',
      borderInput: 'rgb(51 44 38 / 0.7)',
      accentFocus: ACCENT_BRAND,
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl(ACCENT_BRAND, 21, '89%', '40%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    toneKey: 'Sepia',
    presetKey: 'sepia',
    descriptionKey: 'settings.architect.presets.sepiaDesc',
    shell: {
      bgVoid: '#181410',
      bgSurface: '#211C16',
      bgCard: '#2A241C',
      bgHover: '#342C23',
      border: '#3D342A',
      borderHi: '#4C4134',
      textPrimary: '#D6C9B4',
      textHeading: '#E2D6C2',
      textMid: '#A0917B',
      textLabel: '#8F806B',
      textDim: '#6E6152',
      bgInput: '#1D1813',
      bgInputElevated: '#26201A',
      borderInput: 'rgb(61 52 42 / 0.7)',
      accentFocus: '#B45309',
      accentBrand: '#B45309',
    },
    ...focusHsl('#B45309', 26, '90%', '37%'),
    font: 'Inter',
    radius: '14px',
  },
  {
    toneKey: 'Deep Umber',
    presetKey: 'deepUmber',
    descriptionKey: 'settings.architect.presets.deepUmberDesc',
    shell: {
      bgVoid: '#0C0A09',
      bgSurface: '#151110',
      bgCard: '#1D1817',
      bgHover: '#251F1D',
      border: '#2E2624',
      borderHi: '#3B312E',
      textPrimary: '#CFC7BF',
      textHeading: '#DED5CC',
      textMid: '#93887F',
      textLabel: '#847970',
      textDim: '#655C55',
      bgInput: '#110E0D',
      bgInputElevated: '#191413',
      borderInput: 'rgb(46 38 36 / 0.7)',
      accentFocus: '#9A3412',
      accentBrand: '#9A3412',
    },
    ...focusHsl('#9A3412', 17, '79%', '34%'),
    font: 'Inter',
    radius: '10px',
  },
  {
    toneKey: 'Slate Rust',
    presetKey: 'slateRust',
    descriptionKey: 'settings.architect.presets.slateRustDesc',
    shell: {
      bgVoid: '#0E1116',
      bgSurface: '#161B22',
      bgCard: '#1D242D',
      bgHover: '#252D38',
      border: '#2C3540',
      borderHi: '#3A4551',
      textPrimary: '#CBD2DA',
      textHeading: '#DAE0E7',
      textMid: '#8B95A1',
      textLabel: '#7C8692',
      textDim: '#5E6772',
      bgInput: '#12161C',
      bgInputElevated: '#1A2027',
      borderInput: 'rgb(44 53 64 / 0.7)',
      accentFocus: ACCENT_BRAND,
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl(ACCENT_BRAND, 21, '89%', '40%'),
    font: 'Inter',
    radius: '12px',
  },
];

/** Curated theme subset for mobile player-look sheet (desktop shows all). */
export const MOBILE_THEME_PRESET_KEYS = [
  'Focus',
  'Ember',
  'Sepia',
  'Deep Umber',
  'Slate Rust',
  'Tactical Midnight',
  'Deep Ocean',
] as const;

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
