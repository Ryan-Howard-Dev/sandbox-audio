import { describe, expect, it, beforeEach } from 'vitest';
import {
  resolveNativeExoTransitionPrefs,
  shouldSkipWiredRouteRecover,
} from './androidWiredDacPlayback';
import {
  ANDROID_WIRED_DAC_STABILITY_KEY,
  loadAndroidWiredDacStabilityEnabled,
} from './androidNativePlaybackSettings';
import { prefsRemoveItem, prefsSetItem } from './prefsStorage';

describe('resolveNativeExoTransitionPrefs', () => {
  beforeEach(() => {
    prefsRemoveItem(ANDROID_WIRED_DAC_STABILITY_KEY);
  });

  it('disables gapless and crossfade when wired DAC stability is on', () => {
    prefsSetItem(ANDROID_WIRED_DAC_STABILITY_KEY, 'true');
    expect(resolveNativeExoTransitionPrefs()).toEqual({ gapless: false, crossfade: false });
  });

  it('defaults wired DAC stability to enabled', () => {
    expect(loadAndroidWiredDacStabilityEnabled()).toBe(true);
  });
});

describe('shouldSkipWiredRouteRecover', () => {
  it('skips soft-rebind when already wired and playing', () => {
    expect(
      shouldSkipWiredRouteRecover({
        route: 'wired',
        prevRoute: 'wired',
        playbackState: 'playing',
        reason: 'start',
      }),
    ).toBe(true);
  });

  it('allows recover when transitioning onto wired while playing', () => {
    expect(
      shouldSkipWiredRouteRecover({
        route: 'wired',
        prevRoute: 'speaker',
        playbackState: 'playing',
        reason: 'deviceChange',
      }),
    ).toBe(false);
  });

  it('allows becomingNoisyRecovered even when already wired', () => {
    expect(
      shouldSkipWiredRouteRecover({
        route: 'wired',
        prevRoute: 'wired',
        playbackState: 'playing',
        reason: 'becomingNoisyRecovered',
      }),
    ).toBe(false);
  });

  it('allows mid-track glitch recovery when not playing', () => {
    expect(
      shouldSkipWiredRouteRecover({
        route: 'wired',
        prevRoute: 'wired',
        playbackState: 'paused',
        reason: 'deviceChange',
      }),
    ).toBe(false);
  });
});
