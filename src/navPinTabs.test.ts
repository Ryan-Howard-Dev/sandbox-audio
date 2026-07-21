import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_PIN_TABS,
  ensureNavPinTabsLayout,
  loadNavPinTabs,
  NAV_PIN_SLOT_COUNT,
  NAV_PINS_CHANGE_EVENT,
  NAV_PINS_LAYOUT_VERSION,
  saveNavPinTabs,
  setNavPinTab,
} from './navPinTabs';

describe('navPinTabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to home, locker, search, podcasts', () => {
    expect(loadNavPinTabs()).toEqual(DEFAULT_NAV_PIN_TABS);
    expect(loadNavPinTabs().length).toBe(NAV_PIN_SLOT_COUNT);
  });

  it('dedupes and fills to four slots', () => {
    saveNavPinTabs(['discover', 'discover', 'home']);
    expect(loadNavPinTabs()).toEqual(['discover', 'home', 'locker', 'search']);
  });

  it('swaps slot when assigning duplicate tab', () => {
    setNavPinTab(0, 'search');
    expect(loadNavPinTabs()[0]).toBe('search');
    setNavPinTab(3, 'search');
    expect(loadNavPinTabs()[3]).toBe('search');
    expect(new Set(loadNavPinTabs()).size).toBe(4);
  });

  it('migrates to canonical layout once per layout version', () => {
    saveNavPinTabs(['discover', 'home', 'settings', 'locker']);
    localStorage.removeItem('sandbox_nav_pin_tabs_layout_v');
    expect(ensureNavPinTabsLayout()).toEqual(DEFAULT_NAV_PIN_TABS);
    saveNavPinTabs(['discover', 'home', 'settings', 'locker']);
    expect(ensureNavPinTabsLayout()).toEqual(['discover', 'home', 'settings', 'locker']);
    localStorage.setItem('sandbox_nav_pin_tabs_layout_v', String(NAV_PINS_LAYOUT_VERSION));
    expect(ensureNavPinTabsLayout()).toEqual(['discover', 'home', 'settings', 'locker']);
  });
});
