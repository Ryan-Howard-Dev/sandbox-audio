/**
 * Official Sandbox vinyl shade palette — visual swatches for genre mapping.
 * Not community packs; each shade maps to vinyl visual preset values.
 */

import type { VinylVisualSettings } from './vinylVisualSettings';

export interface VinylShade {
  id: string;
  /** Screen-reader / tooltip only — color is the primary label. */
  name: string;
  previewGradient: string;
  visualPreset: Partial<VinylVisualSettings>;
  cssVars?: Record<string, string>;
  vinylClass?: string;
}

const SHADES: VinylShade[] = [
  {
    id: 'void-black',
    name: 'Void Black',
    previewGradient:
      'linear-gradient(90deg, #0a0a0c 0%, #1a1a22 35%, #121218 70%, #08080a 100%)',
    visualPreset: {
      universeIntensity: 0,
      colorThrow: 0,
      pulse: 0,
      hueDrift: 0,
      spinTrail: 0,
      warp: 0,
    },
  },
  {
    id: 'warm-amber',
    name: 'Warm Amber',
    previewGradient:
      'linear-gradient(90deg, #3d1f0a 0%, #8b4513 30%, #c45c26 55%, #6b3410 100%)',
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
  {
    id: 'neon-cyan',
    name: 'Neon Cyan',
    previewGradient:
      'linear-gradient(90deg, #1a0033 0%, #7b2fff 25%, #00e5ff 55%, #ff00cc 85%, #330066 100%)',
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
  {
    id: 'classic-pulse',
    name: 'Classic Pulse',
    previewGradient:
      'linear-gradient(90deg, #141418 0%, #2a1a14 40%, #c44a2a 60%, #1a1210 100%)',
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
  {
    id: 'classic-orange',
    name: 'Classic Orange',
    previewGradient:
      'linear-gradient(90deg, #2a1808 0%, #c45c26 35%, #f0c080 60%, #8b4a18 100%)',
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
  {
    id: 'subtle-bright',
    name: 'Subtle Bright',
    previewGradient:
      'linear-gradient(90deg, #1a1824 0%, #6b5a8a 40%, #f0e6ff 65%, #2a2438 100%)',
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
  {
    id: 'magenta-glow',
    name: 'Magenta Glow',
    previewGradient:
      'linear-gradient(90deg, #1a0820 0%, #a855f7 35%, #ec4899 60%, #4a1860 100%)',
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
  {
    id: 'purple-haze',
    name: 'Purple Haze',
    previewGradient:
      'linear-gradient(90deg, #120818 0%, #5b21b6 30%, #9333ea 55%, #2d1048 100%)',
    visualPreset: {
      universeIntensity: 42,
      colorThrow: 48,
      pulse: 38,
      hueDrift: 42,
      spinTrail: 22,
      warp: 10,
    },
    cssVars: { '--vinyl-addon-glow': '0.55', '--vinyl-addon-tint': '#7c3aed' },
    vinylClass: 'vinyl-addon-community-pulse',
  },
  {
    id: 'emerald-drift',
    name: 'Emerald Drift',
    previewGradient:
      'linear-gradient(90deg, #061410 0%, #0d9488 35%, #34d399 60%, #064e3b 100%)',
    visualPreset: {
      universeIntensity: 38,
      colorThrow: 52,
      pulse: 30,
      hueDrift: 28,
      spinTrail: 25,
      warp: 5,
    },
    cssVars: { '--vinyl-addon-glow': '0.45', '--vinyl-addon-tint': '#14b8a6' },
  },
  {
    id: 'rose-gold',
    name: 'Rose Gold',
    previewGradient:
      'linear-gradient(90deg, #1a1010 0%, #b45309 30%, #fda4af 55%, #78350f 100%)',
    visualPreset: {
      universeIntensity: 28,
      colorThrow: 32,
      pulse: 42,
      hueDrift: 18,
      spinTrail: 14,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-warmth': '0.45', '--vinyl-addon-tint': '#f472b6' },
  },
  {
    id: 'deep-indigo',
    name: 'Deep Indigo',
    previewGradient:
      'linear-gradient(90deg, #080818 0%, #312e81 35%, #6366f1 60%, #1e1b4b 100%)',
    visualPreset: {
      universeIntensity: 32,
      colorThrow: 38,
      pulse: 28,
      hueDrift: 22,
      spinTrail: 20,
      warp: 0,
    },
    cssVars: { '--vinyl-addon-glow': '0.42', '--vinyl-addon-tint': '#6366f1' },
  },
  {
    id: 'tv-hypnosis',
    name: 'TV Hypnosis',
    previewGradient:
      'linear-gradient(90deg, #0a0a14 0%, #1e3a5f 40%, #60a5fa 65%, #0f172a 100%)',
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
  },
];

const shadeById = new Map(SHADES.map((s) => [s.id, s]));

export function getVinylShades(): VinylShade[] {
  return SHADES;
}

export function getVinylShadeById(id: string): VinylShade | undefined {
  return shadeById.get(id);
}

export function isVinylShadeId(id: string): boolean {
  return shadeById.has(id);
}
