/**
 * Map onboarding + taste-profile genre affinity to canonical Explore genre labels.
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import { EXPLORE_GENRES } from './exploreBrowseData';
import { cacheKeyPart } from './responseCache';
import { loadOnboardingTasteSeeds } from './sandboxSettings';
import { getTasteProfile } from './tasteProfile';

function canonicalGenreLabel(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const key = normalizeIdentityKey(trimmed);
  return EXPLORE_GENRES.find((g) => normalizeIdentityKey(g) === key) ?? trimmed;
}

/** Onboarding picks first, then listening-derived genreAffinity (Metal, Hip-Hop, …). */
export function getPersonalizedExploreGenreLabels(limit = 5): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const canonical = canonicalGenreLabel(raw);
    if (!canonical) return;
    const key = normalizeIdentityKey(canonical);
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(canonical);
  };

  for (const genre of loadOnboardingTasteSeeds()?.genres ?? []) {
    add(genre);
  }

  const profile = getTasteProfile();
  const ranked = Object.entries(profile.genreAffinity).sort((a, b) => b[1] - a[1]);
  for (const [genre] of ranked) {
    add(genre);
  }

  return labels.slice(0, limit);
}

export function personalizedGenreCacheFingerprint(genres: string[]): string {
  if (genres.length === 0) return 'generic';
  return cacheKeyPart(genres.join(','));
}
