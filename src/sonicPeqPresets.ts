/**
 * Symfonium-style PEQ preset skeleton — biquad curves applied in Sandbox Sonic.
 */

import type { SonicEqBand } from './sonicEqTypes';
import type { SonicOutputRoute } from './sandboxSonic';

export type SonicPeqPresetId =
  | 'route-auto'
  | 'flat'
  | 'bass-boost'
  | 'warm-room'
  | 'clear-vocals'
  | 'treble-air'
  | 'late-night';

export type SonicPeqPreset = {
  id: SonicPeqPresetId;
  label: string;
  description: string;
  bands: SonicEqBand[];
};

export const SONIC_PEQ_PRESETS: readonly SonicPeqPreset[] = [
  {
    id: 'route-auto',
    label: 'Route auto',
    description: 'Device-aware compensation for speaker, headphones, or TV.',
    bands: [],
  },
  {
    id: 'flat',
    label: 'Flat',
    description: 'No PEQ coloration — bypass preset EQ.',
    bands: [],
  },
  {
    id: 'bass-boost',
    label: 'Bass boost',
    description: 'Gentle sub/low shelf lift.',
    bands: [
      { type: 'lowshelf', frequency: 90, gainDb: 4.0, Q: 0.7 },
      { type: 'peaking', frequency: 55, gainDb: 2.0, Q: 0.9 },
    ],
  },
  {
    id: 'warm-room',
    label: 'Warm room',
    description: 'Fuller lows with softened top end.',
    bands: [
      { type: 'lowshelf', frequency: 140, gainDb: 2.5, Q: 0.7 },
      { type: 'highshelf', frequency: 9000, gainDb: -1.5, Q: 0.7 },
    ],
  },
  {
    id: 'clear-vocals',
    label: 'Clear vocals',
    description: 'Forward mids for voice-led material.',
    bands: [
      { type: 'peaking', frequency: 2800, gainDb: 2.2, Q: 1.1 },
      { type: 'peaking', frequency: 220, gainDb: -2.0, Q: 0.8 },
    ],
  },
  {
    id: 'treble-air',
    label: 'Treble air',
    description: 'Open top end without harshness.',
    bands: [
      { type: 'highshelf', frequency: 10000, gainDb: 2.5, Q: 0.7 },
      { type: 'peaking', frequency: 6500, gainDb: 1.0, Q: 1.2 },
    ],
  },
  {
    id: 'late-night',
    label: 'Late night',
    description: 'Tamed highs and softened bass for low-volume listening.',
    bands: [
      { type: 'highshelf', frequency: 5000, gainDb: -2.5, Q: 0.7 },
      { type: 'lowshelf', frequency: 120, gainDb: -1.5, Q: 0.7 },
    ],
  },
] as const;

export function getSonicPeqPreset(id: SonicPeqPresetId): SonicPeqPreset {
  return SONIC_PEQ_PRESETS.find((p) => p.id === id) ?? SONIC_PEQ_PRESETS[0];
}

export function normalizeSonicPeqPresetId(value: string | null | undefined): SonicPeqPresetId {
  if (SONIC_PEQ_PRESETS.some((p) => p.id === value)) {
    return value as SonicPeqPresetId;
  }
  return 'route-auto';
}

/** Route compensation bands — mirrors sandboxSonic.eqBandsForRoute (exported for tests). */
export function routeEqBands(route: SonicOutputRoute): SonicEqBand[] {
  switch (route) {
    case 'phone-speaker':
      return [
        { type: 'lowshelf', frequency: 120, gainDb: 3.5, Q: 0.7 },
        { type: 'peaking', frequency: 2800, gainDb: 2.0, Q: 1.1 },
        { type: 'highshelf', frequency: 7500, gainDb: -2.5, Q: 0.7 },
      ];
    case 'wired-headphones':
      return [];
    case 'bluetooth':
      return [
        { type: 'peaking', frequency: 3200, gainDb: 1.5, Q: 0.9 },
        { type: 'highshelf', frequency: 9000, gainDb: -1.5, Q: 0.7 },
      ];
    case 'tv-hdmi':
      return [{ type: 'highshelf', frequency: 10000, gainDb: -3.0, Q: 0.7 }];
    case 'laptop':
      return [
        { type: 'lowshelf', frequency: 180, gainDb: 2.5, Q: 0.7 },
        { type: 'peaking', frequency: 3500, gainDb: 1.5, Q: 1.0 },
      ];
    case 'pc-speaker':
      return [
        { type: 'lowshelf', frequency: 150, gainDb: 2.0, Q: 0.7 },
        { type: 'peaking', frequency: 3200, gainDb: 1.0, Q: 1.0 },
        { type: 'highshelf', frequency: 8000, gainDb: -1.5, Q: 0.7 },
      ];
    case 'line-out':
      return [];
    default:
      return [];
  }
}

/** Resolve active PEQ bands for playback (preset overrides route except route-auto / flat). */
export function resolvePlaybackEqBands(
  route: SonicOutputRoute,
  presetId: SonicPeqPresetId,
): SonicEqBand[] {
  if (presetId === 'route-auto') {
    return routeEqBands(route);
  }
  if (presetId === 'flat') {
    return [];
  }
  return getSonicPeqPreset(presetId).bands;
}
