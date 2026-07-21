import { describe, expect, it } from 'vitest';
import {
  shouldOpenMobileNowPlayingOnTrackTap,
  shouldShowMobileHomeVinylSettings,
} from './mobileHomeVinylLogic';

describe('mobile home vinyl tap', () => {
  it('does not auto-open full now playing from home', () => {
    expect(shouldOpenMobileNowPlayingOnTrackTap('home', true)).toBe(false);
    expect(shouldOpenMobileNowPlayingOnTrackTap('home', false)).toBe(false);
  });

  it('does not auto-open full now playing from other stations', () => {
    expect(shouldOpenMobileNowPlayingOnTrackTap('search', true)).toBe(false);
    expect(shouldOpenMobileNowPlayingOnTrackTap('locker', true)).toBe(false);
    expect(shouldOpenMobileNowPlayingOnTrackTap('search', false)).toBe(false);
  });
});

describe('mobile home vinyl settings button', () => {
  it('shows on mobile shell with active track', () => {
    expect(shouldShowMobileHomeVinylSettings(true, true, false)).toBe(true);
  });

  it('hides when idle or not on mobile shell', () => {
    expect(shouldShowMobileHomeVinylSettings(true, true, true)).toBe(false);
    expect(shouldShowMobileHomeVinylSettings(false, true, false)).toBe(false);
    expect(shouldShowMobileHomeVinylSettings(true, false, false)).toBe(false);
  });
});
