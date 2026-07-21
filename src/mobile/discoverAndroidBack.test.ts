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
