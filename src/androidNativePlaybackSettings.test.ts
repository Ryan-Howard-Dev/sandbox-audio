import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANDROID_NATIVE_PLAYBACK_KEY,
  ANDROID_NATIVE_PLAYBACK_LEGACY_KEY,
  ANDROID_USB_BIT_PERFECT_KEY,
  ANDROID_WIRED_DAC_STABILITY_KEY,
  loadAndroidNativePlaybackEnabled,
  loadAndroidUsbBitPerfectEnabled,
  loadAndroidWiredDacStabilityEnabled,
  loadAndroidWebViewCrossfadeEnabled,
} from './androidNativePlaybackSettings';
import { prefsRemoveItem, prefsSetItem } from './prefsStorage';

function clearNativePrefs(): void {
  prefsRemoveItem(ANDROID_NATIVE_PLAYBACK_KEY);
  prefsRemoveItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY);
}

describe('loadAndroidNativePlaybackEnabled', () => {
  beforeEach(() => {
    clearNativePrefs();
  });

  it('defaults to true on fresh install (no pref keys)', () => {
    expect(loadAndroidNativePlaybackEnabled()).toBe(true);
  });

  it('falls back to legacy experimental key when new key is unset', () => {
    prefsSetItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY, 'false');
    expect(loadAndroidNativePlaybackEnabled()).toBe(false);
    prefsSetItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY, 'true');
    expect(loadAndroidNativePlaybackEnabled()).toBe(true);
  });

  it('prefers new key over legacy when both are set', () => {
    prefsSetItem(ANDROID_NATIVE_PLAYBACK_LEGACY_KEY, 'false');
    prefsSetItem(ANDROID_NATIVE_PLAYBACK_KEY, 'true');
    expect(loadAndroidNativePlaybackEnabled()).toBe(true);
  });
});

describe('loadAndroidWebViewCrossfadeEnabled', () => {
  it('defaults to false unless explicitly enabled', () => {
    expect(loadAndroidWebViewCrossfadeEnabled()).toBe(false);
  });
});

describe('loadAndroidUsbBitPerfectEnabled', () => {
  beforeEach(() => {
    prefsRemoveItem(ANDROID_USB_BIT_PERFECT_KEY);
  });

  it('defaults to false unless explicitly enabled', () => {
    expect(loadAndroidUsbBitPerfectEnabled()).toBe(false);
  });
});

describe('loadAndroidWiredDacStabilityEnabled', () => {
  beforeEach(() => {
    prefsRemoveItem(ANDROID_WIRED_DAC_STABILITY_KEY);
  });

  it('defaults to true unless explicitly disabled', () => {
    expect(loadAndroidWiredDacStabilityEnabled()).toBe(true);
    prefsSetItem(ANDROID_WIRED_DAC_STABILITY_KEY, 'false');
    expect(loadAndroidWiredDacStabilityEnabled()).toBe(false);
  });
});
