import type { NavPinTabId } from '../navPinTabs';

/** Fixed overflow tab — always appended after the four pin slots. */
export const MOBILE_MENU_TAB_ID = 'mobile-menu' as const;

export type MobilePinTabId = Exclude<NavPinTabId, 'search'> | 'mobile-search';

/** Map stored pin ids to bottom-nav tab ids (search → mobile-search overlay). */
export function mobilePinTabIdsFromNavPins(pins: NavPinTabId[]): MobilePinTabId[] {
  return pins.map((pin) => (pin === 'search' ? 'mobile-search' : pin));
}

/**
 * Bottom nav ids: four pins + Menu (5 items).
 * Podcasts pin is never removed when the addon is off — tap handling is elsewhere.
 */
export function buildMobileBottomNavTabIds(pins: NavPinTabId[]): Array<MobilePinTabId | typeof MOBILE_MENU_TAB_ID> {
  return [...mobilePinTabIdsFromNavPins(pins), MOBILE_MENU_TAB_ID];
}

export function mobileBottomNavTabCount(pins: NavPinTabId[]): number {
  return buildMobileBottomNavTabIds(pins).length;
}
