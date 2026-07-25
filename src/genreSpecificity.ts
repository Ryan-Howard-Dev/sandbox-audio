/**
 * Genre specificity helpers shared by the tag sources (MusicBrainz, Last.fm).
 *
 * Tag providers rank by popularity, which means the broad parent tag ("hip hop")
 * almost always outranks the interesting one ("trap", "cloud rap", "nu metal").
 * Ranking by popularity alone therefore collapses an entire library into two or
 * three mega-shelves — so we deliberately prefer the most popular *specific*
 * tag and only fall back to a parent genre when nothing specific exists.
 */

/** Broad umbrella genres that make poor shelf names on their own. */
const GENERIC_GENRE_LABELS = new Set([
  'hip hop',
  'hip-hop',
  'hiphop',
  'rap',
  'rock',
  'pop',
  'electronic',
  'electronica',
  'dance',
  'jazz',
  'blues',
  'soul',
  'funk',
  'r&b',
  'rnb',
  'rhythm and blues',
  'metal',
  'punk',
  'indie',
  'alternative',
  'country',
  'folk',
  'classical',
  'reggae',
  'world',
  'soundtrack',
  'experimental',
  'instrumental',
  'acoustic',
  'singer-songwriter',
]);

export function isGenericGenreLabel(name: string): boolean {
  return GENERIC_GENRE_LABELS.has(name.trim().toLowerCase());
}

/**
 * Pick the best shelf label from provider tags already ordered by popularity:
 * the first specific tag wins, otherwise the first generic one.
 */
export function pickMostSpecificGenre(
  namesByPopularity: ReadonlyArray<string | undefined | null>,
): string | null {
  const cleaned = namesByPopularity
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n.length > 0);
  const specific = cleaned.find((n) => !isGenericGenreLabel(n));
  return specific ?? cleaned[0] ?? null;
}

export interface ResolvedGenre {
  /** Umbrella genre for the Genre field (e.g. "hip hop"). */
  genre: string;
  /** Specific style for the Sub-genre field (e.g. "trap"), when distinct. */
  subGenre?: string;
}

/**
 * Split provider tags into an umbrella genre + a specific sub-genre.
 * `['hip hop','trap','conscious hip hop']` → `{ genre:'hip hop', subGenre:'trap' }`.
 * When only specific tags exist (`['nu metal','rapcore']`) the specific one is
 * used as the genre and there is no separate sub-genre.
 */
export function splitGenreTags(
  namesByPopularity: ReadonlyArray<string | undefined | null>,
): ResolvedGenre | null {
  const cleaned = namesByPopularity
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n.length > 0);
  if (cleaned.length === 0) return null;
  const specific = cleaned.find((n) => !isGenericGenreLabel(n));
  const generic = cleaned.find((n) => isGenericGenreLabel(n));
  if (specific && generic) return { genre: generic, subGenre: specific };
  if (specific) return { genre: specific };
  return { genre: generic ?? cleaned[0]! };
}
