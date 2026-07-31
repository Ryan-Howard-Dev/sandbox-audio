/**
 * Memo for pure string -> string transforms that run inside hot de-dupe loops.
 *
 * The name normalizers this wraps call String.prototype.normalize('NFD') plus several regex
 * replaces, and every album/track de-dupe pass calls them again on the same handful of artist and
 * album names. CPU profiling a cold Genres open on device put ~1.7s of main-thread time in one of
 * these normalizers alone.
 *
 * Bounded, and cleared wholesale when full: these keys are unbounded user/remote data (every
 * search result title), so an ever-growing cache would be a leak. Clearing rather than evicting
 * one entry keeps it O(1) and the refill cost is trivial.
 */
export function memoizeStringFn(
  fn: (value: string) => string,
  limit = 4096,
): (value: string) => string {
  const cache = new Map<string, string>();
  return (value: string) => {
    // Callers pass undefined despite the string type in a few places; normalize the key first.
    const key = value ?? '';
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const out = fn(key);
    if (cache.size >= limit) cache.clear();
    cache.set(key, out);
    return out;
  };
}

/**
 * Same idea for pure string -> boolean predicates.
 *
 * The artist-name repair heuristics (leak watermarks, junk labels, stub names) are re-run for
 * every track on every grouping pass, always over the same few hundred names.
 */
export function memoizeStringPredicate(
  fn: (value: string) => boolean,
  limit = 4096,
): (value: string) => boolean {
  const cache = new Map<string, boolean>();
  return (value: string) => {
    const key = value ?? '';
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const out = fn(key);
    if (cache.size >= limit) cache.clear();
    cache.set(key, out);
    return out;
  };
}
