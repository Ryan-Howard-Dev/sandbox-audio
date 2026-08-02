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

/*
 * Ten skins that are actually ten skins.
 *
 * They used not to be. Measured pairwise, six of the darks sat within a perceptual distance of
 * about twenty of each other, which on a near-black background is invisible, and three of them
 * shared the identical accent. On mobile the effect was worst of all: five of the seven offered
 * were from that one indistinguishable cluster, so the picker looked broken rather than subtle.
 *
 * The fix is a lightness ramp. Each dark now sits at a visibly different depth, and each carries
 * an accent at a different temperature, so two of them side by side are obviously two. Greys,
 * oranges and blacks carry the set, with two non-orange skins kept because a palette with no
 * cool option is a worse palette.
 */
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
    // Deepest of the set: a red-black that reads as almost no light at all.
    toneKey: 'Blood Orange',
    presetKey: 'bloodOrange',
    descriptionKey: 'settings.architect.presets.bloodOrangeDesc',
    shell: {
      bgVoid: '#12040A',
      bgSurface: '#1F0810',
      bgCard: '#2B0D17',
      bgHover: '#3A121F',
      border: '#4A1A26',
      borderHi: '#5E2432',
      textPrimary: '#F0D8D4',
      textHeading: '#F8E6E2',
      textMid: '#B98F8C',
      textLabel: '#A87D7A',
      textDim: '#7A5654',
      bgInput: '#180610',
      bgInputElevated: '#240A16',
      borderInput: 'rgb(74 26 38 / 0.6)',
      accentFocus: '#FF4A1C',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#FF4A1C', 14, '100%', '55%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    // Warm brown-black, one clear step lighter than Focus, with a glowing amber.
    toneKey: 'Ember',
    presetKey: 'ember',
    descriptionKey: 'settings.architect.presets.emberDesc',
    shell: {
      bgVoid: '#171009',
      bgSurface: '#241A10',
      bgCard: '#312317',
      bgHover: '#402E1F',
      border: '#4E3A27',
      borderHi: '#634A32',
      textPrimary: '#EADCC9',
      textHeading: '#F5EAD9',
      textMid: '#B29A7C',
      textLabel: '#A08A6E',
      textDim: '#75634E',
      bgInput: '#1D140C',
      bgInputElevated: '#2A1E13',
      borderInput: 'rgb(78 58 39 / 0.6)',
      accentFocus: '#F97316',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#F97316', 25, '95%', '53%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    // A true mid grey. The one skin in the set that is unmistakably not black, which is the whole
    // reason it exists: without it every dark option was a shade of the same darkness.
    toneKey: 'Graphite',
    presetKey: 'graphite',
    descriptionKey: 'settings.architect.presets.graphiteDesc',
    shell: {
      bgVoid: '#1B1D21',
      bgSurface: '#26292F',
      bgCard: '#31353C',
      bgHover: '#3D424A',
      border: '#4A5058',
      borderHi: '#5C636D',
      textPrimary: '#E4E6E9',
      textHeading: '#F2F4F6',
      textMid: '#A8ADB5',
      textLabel: '#959BA3',
      textDim: '#6E747C',
      bgInput: '#22252A',
      bgInputElevated: '#2C3037',
      borderInput: 'rgb(74 80 88 / 0.6)',
      accentFocus: '#FB923C',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#FB923C', 27, '96%', '61%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    // Cool blue-grey. Named for the colour rather than the rust that is no longer in it.
    toneKey: 'Slate',
    presetKey: 'slate',
    descriptionKey: 'settings.architect.presets.slateDesc',
    shell: {
      bgVoid: '#0E1116',
      bgSurface: '#161B22',
      bgCard: '#1D242D',
      bgHover: '#252E39',
      border: '#303A46',
      borderHi: '#3E4A58',
      textPrimary: '#CBD2DA',
      textHeading: '#DDE3EA',
      textMid: '#8C96A2',
      textLabel: '#7C8692',
      textDim: '#59626D',
      bgInput: '#121820',
      bgInputElevated: '#1A222C',
      borderInput: 'rgb(48 58 70 / 0.6)',
      accentFocus: '#EA580C',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#EA580C', 21, '90%', '48%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    // Pure black and amber, for maximum contrast. Kept as the accessibility option.
    toneKey: 'Terminal',
    presetKey: 'terminal',
    descriptionKey: 'settings.architect.presets.terminalDesc',
    shell: {
      bgVoid: '#000000',
      bgSurface: '#0A0A0A',
      bgCard: '#121212',
      bgHover: '#1C1C1C',
      border: '#2E2E2E',
      borderHi: '#454545',
      textPrimary: '#FFFFFF',
      textHeading: '#FFFFFF',
      textMid: '#C4C4C4',
      textLabel: '#B0B0B0',
      textDim: '#8A8A8A',
      bgInput: '#0A0A0A',
      bgInputElevated: '#141414',
      borderInput: 'rgb(46 46 46 / 0.8)',
      accentFocus: '#FFB000',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#FFB000', 41, '100%', '50%'),
    font: 'IBM Plex Mono',
    radius: '4px',
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
    toneKey: 'Deep Ocean',
    presetKey: 'deepOcean',
    descriptionKey: 'settings.architect.presets.deepOceanDesc',
    shell: {
      bgVoid: '#020B14',
      bgSurface: '#0F2A2E',
      bgCard: '#134E4A',
      bgHover: '#186460',
      border: '#1F6F6A',
      borderHi: '#2A8A84',
      textPrimary: '#CBE4F5',
      textHeading: '#DFF0FA',
      textMid: '#8FB8C9',
      textLabel: '#7FA8BA',
      textDim: '#5A7E8E',
      bgInput: '#08161E',
      bgInputElevated: '#0F2A2E',
      borderInput: 'rgb(31 111 106 / 0.55)',
      accentFocus: '#0EA5E9',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#0EA5E9', 199, '89%', '48%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    /*
     * Light, and deliberately not white. Pure #FFFFFF against dark text is the combination people
     * turn their screen brightness down to escape; an off-white with a trace of warmth in it reads
     * for longer without the glare. Greys carry the structure so the orange stays an accent.
     */
    toneKey: 'Light Canvas',
    presetKey: 'lightCanvas',
    descriptionKey: 'settings.architect.presets.lightCanvasDesc',
    shell: {
      bgVoid: '#EDE9E4',
      bgSurface: '#F7F4F0',
      bgCard: '#FDFBF8',
      bgHover: '#F0EBE4',
      border: '#D8D2C9',
      borderHi: '#C3BCB1',
      textPrimary: '#2A2724',
      textHeading: '#1A1816',
      textMid: '#5F5952',
      textLabel: '#6E6860',
      textDim: '#8C857C',
      bgInput: '#FFFFFF',
      bgInputElevated: '#F7F4F0',
      borderInput: 'rgb(216 210 201 / 0.9)',
      accentFocus: '#C2410C',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#C2410C', 21, '89%', '40%'),
    font: 'Inter',
    radius: '12px',
  },
  {
    /*
     * The second light skin, warmer still. It used to be a dark brown indistinguishable from Ember,
     * which wasted the one name in the set that means paper. There are two light options now
     * because this app is also read from, and a reader wants a choice of paper.
     */
    toneKey: 'Sepia',
    presetKey: 'sepia',
    descriptionKey: 'settings.architect.presets.sepiaDesc',
    shell: {
      bgVoid: '#E8DFCE',
      bgSurface: '#F4ECDC',
      bgCard: '#FAF3E6',
      bgHover: '#EFE5D2',
      border: '#D6C9AE',
      borderHi: '#C0B094',
      textPrimary: '#3A3226',
      textHeading: '#2A231A',
      textMid: '#6B5F4C',
      textLabel: '#7A6D58',
      textDim: '#97886F',
      bgInput: '#FAF3E6',
      bgInputElevated: '#F4ECDC',
      borderInput: 'rgb(214 201 174 / 0.9)',
      accentFocus: '#B45309',
      accentBrand: ACCENT_BRAND,
    },
    ...focusHsl('#B45309', 27, '90%', '37%'),
    font: 'Inter',
    radius: '12px',
  },
];

/*
 * What a phone offers. Chosen so that no two are close: three depths of dark, one true grey,
 * one pure black, one light. The old list was five members of the same indistinguishable
 * cluster, which is why the picker looked broken.
 */
export const MOBILE_THEME_PRESET_KEYS = [
  'Focus',
  'Blood Orange',
  'Ember',
  'Graphite',
  'Terminal',
  'Deep Ocean',
  'Light Canvas',
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
  /*
   * Renames, so a skin chosen before this change still resolves. Deep Umber and HC Terminal
   * were folded into neighbours they were already indistinguishable from.
   */
  if (tone === 'Blood Moon') return 'Blood Orange';
  if (tone === 'Slate Rust') return 'Slate';
  if (tone === 'HC Terminal') return 'Terminal';
  if (tone === 'Deep Umber') return 'Ember';
  if (tone === 'Custom Override') return 'Custom CSS';
  return tone;
}
