import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { LockerBrowseFilterId } from './components/locker/lockerBrowseFilters';

export type LockerSortBy = 'title' | 'priority' | 'added' | 'artist';
export type LockerLayoutMode = 'grid' | 'list';
export type LockerViewMode = 'albums' | 'tracks';

export type LockerViewPrefs = {
  sortBy: LockerSortBy;
  viewMode: LockerViewMode;
  layoutMode: LockerLayoutMode;
  browseFilter: LockerBrowseFilterId;
};

const KEY = 'sandbox_locker_view_prefs_v1';

const DEFAULTS: LockerViewPrefs = {
  sortBy: 'title',
  viewMode: 'albums',
  layoutMode: 'grid',
  browseFilter: 'all',
};

export function loadLockerViewPrefs(): LockerViewPrefs {
  try {
    const raw = prefsGetItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LockerViewPrefs>;
    return {
      sortBy: parsed.sortBy ?? DEFAULTS.sortBy,
      viewMode: parsed.viewMode ?? DEFAULTS.viewMode,
      layoutMode: parsed.layoutMode ?? DEFAULTS.layoutMode,
      browseFilter: parsed.browseFilter ?? DEFAULTS.browseFilter,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLockerViewPrefs(partial: Partial<LockerViewPrefs>): LockerViewPrefs {
  const next = { ...loadLockerViewPrefs(), ...partial };
  prefsSetItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('sandbox-locker-view-prefs-change'));
  return next;
}
