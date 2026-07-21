/** Dynamic catalog query for "new music" shelves — rotates with the calendar year. */
export function newMusicSearchLabel(year = new Date().getFullYear()): string {
  return `new music ${year}`;
}

/** Week-of-year suffix so quick shelves refresh across the month, not only on cache TTL. */
export function newMusicExploreCachePart(
  year = new Date().getFullYear(),
  tasteFingerprint = 'generic',
): string {
  const week = Math.floor(
    (Date.now() - Date.UTC(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000),
  );
  return `${newMusicSearchLabel(year)}|w${week}|t:${tasteFingerprint}`;
}

/** True for explore-style new-music queries (any year). */
export function isNewMusicQuery(query: string): boolean {
  return /new\s+music(?:\s+\d{4})?/i.test(query.trim());
}
