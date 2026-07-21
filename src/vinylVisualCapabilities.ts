/**
 * Per-device caps for vinyl psychedelic visuals — same settings UI, scaled output.
 */

import { isCarModeActive } from './carMode';
import {
  isMusicUniverseViewport,
  isNativePhoneShell,
} from './musicUniverse';
import { detectTVPlatform } from './tvDetection';
import { getPlatformDiagnostics, isTauri } from './platformEnv';
import type { VinylVisualSettings } from './vinylVisualSettings';

export interface VinylVisualDeviceProfile {
  intensityCap: number;
  colorThrowCap: number;
  pulseCap: number;
  hueDriftCap: number;
  spinTrailCap: number;
  warpCap: number;
  enableStreaks: boolean;
  enableRings: boolean;
  animationSpeedMul: number;
}

export interface EffectiveVinylVisuals extends VinylVisualSettings {
  enableStreaks: boolean;
  enableRings: boolean;
  animationSpeedMul: number;
}

function clamp0_100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** User slider × device cap (both 0–100). */
function applyCap(userValue: number, capPercent: number): number {
  return clamp0_100((userValue * capPercent) / 100);
}

export function prefersReducedVinylMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function getVinylVisualDeviceProfile(): VinylVisualDeviceProfile {
  if (isCarModeActive()) {
    return {
      intensityCap: 0,
      colorThrowCap: 0,
      pulseCap: 0,
      hueDriftCap: 0,
      spinTrailCap: 0,
      warpCap: 0,
      enableStreaks: false,
      enableRings: false,
      animationSpeedMul: 1,
    };
  }

  if (prefersReducedVinylMotion()) {
    return {
      intensityCap: 12,
      colorThrowCap: 0,
      pulseCap: 8,
      hueDriftCap: 0,
      spinTrailCap: 0,
      warpCap: 0,
      enableStreaks: false,
      enableRings: false,
      animationSpeedMul: 0,
    };
  }

  const { isAndroidTv } = getPlatformDiagnostics();
  const isTv = isAndroidTv || detectTVPlatform();

  if (isTv) {
    return {
      intensityCap: 100,
      colorThrowCap: 100,
      pulseCap: 70,
      hueDriftCap: 60,
      spinTrailCap: 50,
      warpCap: 0,
      enableStreaks: true,
      enableRings: true,
      animationSpeedMul: 0.65,
    };
  }

  if (isNativePhoneShell()) {
    return {
      intensityCap: 55,
      colorThrowCap: 25,
      pulseCap: 45,
      hueDriftCap: 50,
      spinTrailCap: 20,
      warpCap: 0,
      enableStreaks: true,
      enableRings: true,
      animationSpeedMul: 0.9,
    };
  }

  if (isTauri()) {
    return {
      intensityCap: 100,
      colorThrowCap: 100,
      pulseCap: 100,
      hueDriftCap: 100,
      spinTrailCap: 100,
      warpCap: 100,
      enableStreaks: true,
      enableRings: true,
      animationSpeedMul: 1,
    };
  }

  if (isMusicUniverseViewport()) {
    return {
      intensityCap: 100,
      colorThrowCap: 100,
      pulseCap: 100,
      hueDriftCap: 100,
      spinTrailCap: 100,
      warpCap: 80,
      enableStreaks: true,
      enableRings: true,
      animationSpeedMul: 1,
    };
  }

  return {
    intensityCap: 55,
    colorThrowCap: 25,
    pulseCap: 45,
    hueDriftCap: 50,
    spinTrailCap: 20,
    warpCap: 0,
    enableStreaks: true,
    enableRings: true,
    animationSpeedMul: 0.9,
  };
}

/** True when visuals are capped below desktop/TV full effects (phone or narrow viewport). */
export function usesVinylPreviewQualityProfile(): boolean {
  const profile = getVinylVisualDeviceProfile();
  return (
    profile.intensityCap < 100 ||
    profile.colorThrowCap < 100 ||
    profile.spinTrailCap < 100 ||
    profile.warpCap < 100 ||
    profile.animationSpeedMul < 1
  );
}

export function applyVinylVisualCaps(settings: VinylVisualSettings): EffectiveVinylVisuals {
  const profile = getVinylVisualDeviceProfile();
  return {
    universeIntensity: applyCap(settings.universeIntensity, profile.intensityCap),
    colorThrow: applyCap(settings.colorThrow, profile.colorThrowCap),
    pulse: applyCap(settings.pulse, profile.pulseCap),
    hueDrift: applyCap(settings.hueDrift, profile.hueDriftCap),
    spinTrail: applyCap(settings.spinTrail, profile.spinTrailCap),
    warp: applyCap(settings.warp, profile.warpCap),
    artBlend: clamp0_100(settings.artBlend),
    enableStreaks: profile.enableStreaks,
    enableRings: profile.enableRings,
    animationSpeedMul: profile.animationSpeedMul,
  };
}
