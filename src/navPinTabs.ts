/**
 * Four pinned primary navigation tabs plus a fixed Menu overflow (5 bottom destinations).
 * Default: Home · Library · Search · Podcasts · Menu (hamburger).
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const NAV_PIN_SLOT_COUNT = 4;

export const NAV_PIN_CANDIDATES = [
  'home',
  'locker',
  'discover',
  'search',
  'podcasts',
  'audiobooks',
  'settings',
] as const;

export type NavPinTabId = (typeof NAV_PIN_CANDIDATES)[number];

export const DEFAULT_NAV_PIN_TABS: NavPinTabId[] = ['home', 'locker', 'search', 'podcasts'];

const NAV_PINS_KEY = 'sandbox_nav_pin_tabs_v1';
/** Bumped when canonical mobile pin layout changes — re-applies defaults once per bump. */
const NAV_PINS_LAYOUT_VERSION_KEY = 'sandbox_nav_pin_tabs_layout_v';
export const NAV_PINS_LAYOUT_VERSION = 1;
export const NAV_PINS_CHANGE_EVENT = 'sandbox-nav-pins-change';

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NAV_PINS_CHANGE_EVENT));
  }
}

function isNavPinTabId(value: string): value is NavPinTabId {
  return (NAV_PIN_CANDIDATES as readonly string[]).includes(value);
}

function normalizeTabs(raw: unknown): NavPinTabId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_NAV_PIN_TABS];
  const seen = new Set<NavPinTabId>();
  const out: NavPinTabId[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !isNavPinTabId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  for (const fallback of DEFAULT_NAV_PIN_TABS) {
    if (out.length >= NAV_PIN_SLOT_COUNT) break;
    if (!seen.has(fallback)) {
      seen.add(fallback);
      out.push(fallback);
    }
  }
  return out.slice(0, NAV_PIN_SLOT_COUNT);
}

function readStoredNavPinTabs(): NavPinTabId[] {
  try {
    const raw = prefsGetItem(NAV_PINS_KEY);
    if (!raw) return [...DEFAULT_NAV_PIN_TABS];
    return normalizeTabs(JSON.parse(raw));
  } catch {
    return [...DEFAULT_NAV_PIN_TABS];
  }
}

/**
 * One-shot migration: lock bottom nav to Home · Library · Search · Pods (+ Menu).
 * Survives app updates; only re-runs when NAV_PINS_LAYOUT_VERSION increments.
 */
export function ensureNavPinTabsLayout(): NavPinTabId[] {
  const storedVersion = parseInt(prefsGetItem(NAV_PINS_LAYOUT_VERSION_KEY) ?? '0', 10);
  if (storedVersion >= NAV_PINS_LAYOUT_VERSION) {
    return readStoredNavPinTabs();
  }
  const migrated = [...DEFAULT_NAV_PIN_TABS];
  prefsSetItem(NAV_PINS_KEY, JSON.stringify(migrated));
  prefsSetItem(NAV_PINS_LAYOUT_VERSION_KEY, String(NAV_PINS_LAYOUT_VERSION));
  return migrated;
}

export function loadNavPinTabs(): NavPinTabId[] {
  return readStoredNavPinTabs();
}

export function saveNavPinTabs(tabs: NavPinTabId[]): void {
  const next = normalizeTabs(tabs);
  prefsSetItem(NAV_PINS_KEY, JSON.stringify(next));
  notify();
}

export function setNavPinTab(slotIndex: number, tabId: NavPinTabId): NavPinTabId[] {
  const current = loadNavPinTabs();
  const next = [...current];
  const idx = Math.max(0, Math.min(NAV_PIN_SLOT_COUNT - 1, slotIndex));
  const existing = next.indexOf(tabId);
  if (existing >= 0 && existing !== idx) {
    next[existing] = next[idx]!;
  }
  next[idx] = tabId;
  saveNavPinTabs(next);
  return next;
}

export function subscribeNavPinTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navPinTabIdSet(tabs: NavPinTabId[] = loadNavPinTabs()): Set<string> {
  return new Set(tabs);
}

/** Stations shown in More overflow (not in the 3 pins). */
export type NavOverflowStationId =
  | 'discover'
  | 'podcasts'
  | 'library'
  | 'settings'
  | 'sonic-locker'
  | 'dj'
  | 'insights';

export function isNavPinTab(stationId: string, pins: NavPinTabId[] = loadNavPinTabs()): boolean {
  if (stationId === 'mobile-search' || stationId === 'search') {
    return pins.includes('search');
  }
  return pins.includes(stationId as NavPinTabId);
}
