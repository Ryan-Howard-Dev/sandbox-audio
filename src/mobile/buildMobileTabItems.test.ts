import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_PIN_TABS } from '../navPinTabs';
import {
  buildMobileBottomNavTabIds,
  MOBILE_MENU_TAB_ID,
  mobileBottomNavTabCount,
  mobilePinTabIdsFromNavPins,
} from './buildMobileTabItems';

describe('buildMobileTabItems', () => {
  it('always yields five bottom destinations on default pins', () => {
    expect(mobileBottomNavTabCount(DEFAULT_NAV_PIN_TABS)).toBe(5);
    expect(buildMobileBottomNavTabIds(DEFAULT_NAV_PIN_TABS)).toEqual([
      'home',
      'locker',
      'mobile-search',
      'podcasts',
      MOBILE_MENU_TAB_ID,
    ]);
  });

  it('keeps podcasts pin when addon would be off (count still five)', () => {
    const pins = DEFAULT_NAV_PIN_TABS;
    expect(mobilePinTabIdsFromNavPins(pins)).toContain('podcasts');
    expect(mobileBottomNavTabCount(pins)).toBe(5);
  });

  it('maps search pin to mobile-search overlay id', () => {
    expect(mobilePinTabIdsFromNavPins(['home', 'locker', 'search', 'podcasts'])).toEqual([
      'home',
      'locker',
      'mobile-search',
      'podcasts',
    ]);
  });
});
