import { describe, expect, it } from 'vitest';
import { resolveDiscoverHardwareBack } from './discoverAndroidBack';

describe('resolveDiscoverHardwareBack', () => {
  it('Browse tab → For you (stay in app)', () => {
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'explore',
        discoverDrillFromTab: null,
      }),
    ).toEqual({ handled: true, nextTab: 'feed', clearDrill: true });
  });

  it('Playlists screen → For you', () => {
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'playlists',
        discoverDrillFromTab: 'feed',
      }),
    ).toEqual({ handled: true, nextTab: 'feed', clearDrill: true });
  });

  it('For you is discover root — allow shell minimize', () => {
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'feed',
        discoverDrillFromTab: null,
      }),
    ).toEqual({ handled: false });
  });

  it('returns to the tab Browse was opened from, not the root', () => {
    // The missing back entry: the drill origin was recorded but discarded, so backing out of
    // Browse-opened-from-Playlists landed on Feed.
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'explore',
        discoverDrillFromTab: 'playlists',
      }),
    ).toEqual({ handled: true, nextTab: 'playlists', clearDrill: true });
  });

  it('returns to Browse when Feed was drilled into from Browse', () => {
    // Previously unhandled, which minimized the app instead of going back.
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'feed',
        discoverDrillFromTab: 'explore',
      }),
    ).toEqual({ handled: true, nextTab: 'explore', clearDrill: true });
  });

  it('falls back to the root tab when the origin is the current tab', () => {
    expect(
      resolveDiscoverHardwareBack({
        station: 'discover',
        discoverTab: 'explore',
        discoverDrillFromTab: 'explore',
      }),
    ).toEqual({ handled: true, nextTab: 'feed', clearDrill: true });
  });

  it('ignores non-discover stations', () => {
    expect(
      resolveDiscoverHardwareBack({
        station: 'locker',
        discoverTab: 'explore',
        discoverDrillFromTab: null,
      }),
    ).toEqual({ handled: false });
  });
});
