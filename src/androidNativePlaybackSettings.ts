/**
 * Android playback path prefs — ExoPlayer default, WebView opt-in for crossfade.
 * See docs/android-playback.md and src/androidNativePlayback.ts.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

/** Legacy experimental key — migrated on read when the new key is unset. */
export const ANDROID_NATIVE_PLAYBACK_LEGACY_KEY = 'sandbox_android_native_playback_experimental';

/** Native ExoPlayer decode (default ON for new installs). */
export const ANDROID_NATIVE_PLAYBACK_KEY = 'sandbox_android_native_playback';

/** Legacy WebView HTMLAudioElement decode — only escape hatch when native crossfade is insufficient. */
export const ANDROID_WEBVIEW_CROSSFADE_KEY = 'sandbox_android_webview_crossfade';

/** Phase 2a — bit-perfect USB DAC output (API 34+, probe-gated). Default OFF. */
export const ANDROID_USB_BIT_PERFECT_KEY = 'sandbox_android_usb_bit_perfect';

/** USB-C DAC / wired IEM stability — larger buffers, no gapless/crossfade, route recovery. Default ON. */
export const ANDROID_WIRED_DAC_STABILITY_KEY = 'sandbox_android_wired_dac_stability';

function readNativePlaybackPref(): string | null {
  const current = prefsGetItem(ANDROID_NATIVE_PLAYBACK_KEY);
  if (current !== null) return current;
  return prefsGetItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY);
}

/** True when ExoPlayer should decode (default ON). */
export function loadAndroidNativePlaybackEnabled(): boolean {
  const raw = readNativePlaybackPref();
  if (raw === null) return true;
  return raw === 'true';
}

export function saveAndroidNativePlaybackEnabled(enabled: boolean): void {
  prefsSetItem(ANDROID_NATIVE_PLAYBACK_KEY, String(enabled));
  prefsSetItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** True when user opted into WebView decode for crossfade routing. */
export function loadAndroidWebViewCrossfadeEnabled(): boolean {
  return prefsGetItem(ANDROID_WEBVIEW_CROSSFADE_KEY) === 'true';
}

export function saveAndroidWebViewCrossfadeEnabled(enabled: boolean): void {
  prefsSetItem(ANDROID_WEBVIEW_CROSSFADE_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** True when user opted into bit-perfect USB DAC (experimental, API 34+). */
export function loadAndroidUsbBitPerfectEnabled(): boolean {
  return prefsGetItem(ANDROID_USB_BIT_PERFECT_KEY) === 'true';
}

export function saveAndroidUsbBitPerfectEnabled(enabled: boolean): void {
  prefsSetItem(ANDROID_USB_BIT_PERFECT_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** True when wired USB DAC stability mode is enabled (default ON). */
export function loadAndroidWiredDacStabilityEnabled(): boolean {
  const raw = prefsGetItem(ANDROID_WIRED_DAC_STABILITY_KEY);
  if (raw === null) return true;
  return raw === 'true';
}

export function saveAndroidWiredDacStabilityEnabled(enabled: boolean): void {
  prefsSetItem(ANDROID_WIRED_DAC_STABILITY_KEY, String(enabled));
  window.dispatchEvent(new Event('sandbox-settings-change'));
}
