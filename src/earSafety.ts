/**
 * Ear-safe listening — session loudness exposure proxy (on-device only).
 *
 * Tracks time at high user volume (≥85%) while playing. After ~60 minutes
 * equivalent exposure, applies gentle gain reduction (never mutes). Optional
 * one-time toast via `sandbox-ear-safety-toast` CustomEvent.
 */

import { loadEarSafeListeningEnabled } from './sandboxSettings';

export const EAR_SAFETY_HIGH_VOLUME_THRESHOLD = 0.85;
/** Minutes at ≥85% volume before soft limiting begins. */
export const EAR_SAFETY_BUDGET_MINUTES = 60;
/** Floor gain multiplier — never brick volume. */
export const EAR_SAFETY_MIN_GAIN = 0.72;

const BUDGET_SECONDS = EAR_SAFETY_BUDGET_MINUTES * 60;
const RAMP_SECONDS = 30 * 60;

let highVolumeSeconds = 0;
let lastTickMs = 0;
let toastShown = false;
let currentGain = 1;

export function resetEarSafetySession(): void {
  highVolumeSeconds = 0;
  lastTickMs = 0;
  toastShown = false;
  currentGain = 1;
}

export function getEarSafetyGain(): number {
  return loadEarSafeListeningEnabled() ? currentGain : 1;
}

export function getEarSafetyExposureMinutes(): number {
  return highVolumeSeconds / 60;
}

function dispatchEarSafetyToast(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('sandbox-ear-safety-toast', {
      detail: { key: 'settings.playback.sonicEarSafeToast' },
    }),
  );
}

/**
 * Update exposure model and return gain multiplier for the ear-safety stage.
 * Call periodically while audio is playing (e.g. from PlaybackCrossfadeRouter).
 */
export function tickEarSafety(
  userVolume: number,
  isPlaying: boolean,
  nowMs = Date.now(),
): number {
  if (!loadEarSafeListeningEnabled()) {
    currentGain = 1;
    return 1;
  }

  if (lastTickMs > 0 && isPlaying && userVolume >= EAR_SAFETY_HIGH_VOLUME_THRESHOLD) {
    highVolumeSeconds += Math.max(0, (nowMs - lastTickMs) / 1000);
  }
  lastTickMs = nowMs;

  const excess = highVolumeSeconds - BUDGET_SECONDS;
  if (excess <= 0) {
    currentGain = 1;
    return 1;
  }

  const ramp = Math.min(1, excess / RAMP_SECONDS);
  currentGain = 1 - ramp * (1 - EAR_SAFETY_MIN_GAIN);

  if (!toastShown && excess > 30) {
    toastShown = true;
    dispatchEarSafetyToast();
  }

  return currentGain;
}
