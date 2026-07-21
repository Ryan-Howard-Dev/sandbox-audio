import { describe, expect, it } from 'vitest';
import { resolveMobileTabActiveId } from './mobileTabActiveLogic';

const DEFAULT_PINS = ['home', 'locker', 'search', 'podcasts'] as const;

function pinned(...ids: string[]) {
  return new Set(ids);
}

describe('resolveMobileTabActiveId', () => {
  it('highlights menu for discover feed', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'discover',
        discoverTab: 'feed',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
  });

  it('highlights menu for discover explore (Browse tab)', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'discover',
        discoverTab: 'explore',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
  });

  it('highlights menu for discover playlists', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'discover',
        discoverTab: 'playlists',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
  });

  it('highlights home when on home station', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'home',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('home');
  });

  it('does not regress pinned locker/search/podcasts stations', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'locker',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('locker');
    expect(
      resolveMobileTabActiveId({
        station: 'podcasts',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('podcasts');
  });

  it('maps menu-overflow stations to menu', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'podcasts');
    expect(
      resolveMobileTabActiveId({
        station: 'settings',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
    expect(
      resolveMobileTabActiveId({
        station: 'sonic-locker',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
    expect(
      resolveMobileTabActiveId({
        station: 'audiobooks',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: DEFAULT_PINS,
      }),
    ).toBe('mobile-menu');
  });

  it('highlights pinned audiobooks tab when on audiobooks', () => {
    const pins = pinned('home', 'locker', 'mobile-search', 'audiobooks');
    expect(
      resolveMobileTabActiveId({
        station: 'audiobooks',
        mobileSearchOpen: false,
        pinnedTabIds: pins,
        navPinTabs: ['home', 'locker', 'search', 'audiobooks'],
      }),
    ).toBe('audiobooks');
  });
});
