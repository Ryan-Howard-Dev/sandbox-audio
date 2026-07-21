/**
 * Discovery hub shelf definitions — curated rows for Feed & Explore.
 */

import type { ExploreGroup } from './exploreCatalog';
import { EXPLORE_GENRES, EXPLORE_MOODS } from './exploreBrowseData';
import { newMusicSearchLabel } from './newMusicQuery';

export interface HubShelfPick {
  id: string;
  title: string;
  subtitle?: string;
  group: ExploreGroup;
  label: string;
}

function shelf(
  id: string,
  title: string,
  label: string,
  group: ExploreGroup,
  subtitle?: string,
): HubShelfPick {
  return { id, title, label, group, subtitle };
}

/** Hero rows at top of Explore hub. */
export const QUICK_HUB_SHELVES: HubShelfPick[] = [
  shelf('new-releases', 'New releases', newMusicSearchLabel(), 'quick', 'Fresh from catalog'),
  shelf('top-charts', 'Top charts', 'top hits', 'quick', 'Trending now'),
];

/** Featured genre carousels. */
export const FEATURED_GENRE_SHELVES: HubShelfPick[] = (
  ['Pop', 'Hip-Hop', 'Dance & Electronic', 'R&B / Soul', 'Rock / Indie', 'Jazz'] as const
).map((label) => shelf(`genre-${label}`, label, label, 'genre'));

/** Mood & activity carousels. */
export const FEATURED_MOOD_SHELVES: HubShelfPick[] = (
  ['Chill', 'Workout', 'Focus', 'Party'] as const
).map((label) => shelf(`mood-${label}`, label, label, 'mood'));

/** Compact browse row on Feed (links into Explore). */
export const FEED_BROWSE_SHELVES: HubShelfPick[] = [
  ...QUICK_HUB_SHELVES,
  ...FEATURED_GENRE_SHELVES.slice(0, 4),
];

export const ALL_EXPLORE_HUB_SHELVES: HubShelfPick[] = [
  ...QUICK_HUB_SHELVES,
  ...FEATURED_GENRE_SHELVES,
  ...FEATURED_MOOD_SHELVES,
];
