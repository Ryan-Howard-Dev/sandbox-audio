import type { ExploreGroup } from './exploreCatalog';
import { newMusicSearchLabel } from './newMusicQuery';

export const EXPLORE_GENRES = [
  'Hip-Hop',
  'Pop',
  'R&B / Soul',
  'Rock / Indie',
  'Metal',
  'Alternative',
  'Dance & Electronic',
  'Latin',
  'Country',
  'Jazz',
  'Blues',
  'Classical',
  'Folk',
  'Reggae / Dancehall',
  'K-Pop',
  'Afrobeats',
  'Gospel',
  'Soundtrack',
] as const;

export const EXPLORE_MOODS = [
  'For DJs',
  'Chill',
  'Workout',
  'Focus',
  'Party',
  'Relax',
  'Drive',
  'Sleep',
  'Wellness',
] as const;

export const SEARCH_BROWSE_MOODS = [
  'For DJs',
  'Chill',
  'Workout',
  'Focus',
  'Party',
  'Relax',
  'Drive',
  'Sleep',
] as const;

export const EXPLORE_DECADES = [
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
] as const;

/** Compact decade row for the search browse overlay. */
export const SEARCH_BROWSE_DECADES = [
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
] as const;

export type QuickBrowseAction =
  | { kind: 'explore'; label: string; group: ExploreGroup }
  | { kind: 'navigate'; station: 'locker' | 'podcasts' }
  | { kind: 'videoFeed' };

export interface QuickBrowseFilter {
  id: string;
  label: string;
  action: QuickBrowseAction;
}

export const SEARCH_QUICK_FILTERS: QuickBrowseFilter[] = [
  {
    id: 'new',
    label: 'New',
    action: { kind: 'explore', label: newMusicSearchLabel(), group: 'quick' },
  },
  { id: 'top', label: 'Top', action: { kind: 'explore', label: 'top hits', group: 'quick' } },
  { id: 'locker', label: 'Locker', action: { kind: 'navigate', station: 'locker' } },
];

export const SEARCH_QUICK_FILTER_PODCASTS: QuickBrowseFilter = {
  id: 'podcasts',
  label: 'Podcasts',
  action: { kind: 'navigate', station: 'podcasts' },
};

export const SEARCH_QUICK_FILTER_VIDEOS: QuickBrowseFilter = {
  id: 'videos',
  label: 'Videos',
  action: { kind: 'videoFeed' },
};
