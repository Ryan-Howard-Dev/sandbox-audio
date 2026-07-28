/**
 * Merging results from sources whose scores mean nothing to each other.
 *
 * A search here fans out to the locker, iTunes, YouTube, PodcastIndex and a row of scrapers. Each
 * returns a ranked list, and each ranks by its own private arithmetic: the locker scores substring
 * hits into the hundreds, iTunes uses its own relevance, a scraper may return whatever order its
 * page happened to be in. Adding or averaging those numbers is meaningless — whichever source
 * emits the largest scalar wins every time, regardless of whether it was right.
 *
 * Reciprocal Rank Fusion ignores the scores entirely and uses only *position*. A result's worth is
 * the sum of 1/(k + rank) across every list it appears in, so agreement between independent
 * sources is what lifts something to the top. That is the useful signal: if the locker and iTunes
 * both put a track near the front, they are unlikely to be wrong together.
 *
 * It also rescues the failure this project hit for real. A local parse that guesses the artist
 * wrongly ranks the right track poorly, but iTunes still returns it first — and the fused score
 * carries it back to the top. Wrong guesses cost ranking, not results, which is precisely the
 * property the search fix was written to guarantee.
 */

/**
 * Smoothing constant from the original RRF paper.
 *
 * Without it, rank 1 scores 1 and rank 2 scores 0.5 — one source's top pick would outweigh
 * agreement between three others. At 60 the gap between adjacent ranks is small, so consensus
 * across lists outweighs any single list's confidence, which is the whole point of fusing.
 */
export const RRF_K = 60;

export interface RankedList<T> {
  /** Where these came from. Kept so a result can say which sources agreed. */
  source: string;
  /** Best first. Position is all that is read; any score the source assigned is ignored. */
  items: T[];
  /**
   * Relative trust in this source, default 1.
   *
   * A deliberate escape hatch rather than a scoring backdoor: the locker is the user's own library
   * and a hit there is worth more than a scraper's guess. It scales the contribution, it does not
   * replace rank with score.
   */
  weight?: number;
}

export interface FusedResult<T> {
  item: T;
  score: number;
  /** Sources that returned this at all, in the order given. */
  sources: string[];
  /** Best position achieved in any list — the tiebreak when scores are equal. */
  bestRank: number;
}

export interface FuseOptions {
  k?: number;
  /** Cap on the returned list. Fusion still considers every input. */
  limit?: number;
}

/**
 * Fuse ranked lists into one order.
 *
 * `identity` decides what counts as the same thing across sources, and it carries the weight here:
 * too loose and two different songs merge, too strict and the same track from the locker and from
 * iTunes never agrees with itself — which silently disables the consensus this exists to measure.
 *
 * The first occurrence of an item is kept. Sources are consulted in the order given, so a caller
 * that puts the locker first keeps its own metadata rather than a scraper's rendering of it.
 */
export function fuseRankedLists<T>(
  lists: Array<RankedList<T>>,
  identity: (item: T) => string,
  options: FuseOptions = {},
): Array<FusedResult<T>> {
  const k = options.k ?? RRF_K;
  const fused = new Map<string, FusedResult<T>>();

  for (const list of lists) {
    if (!list || !Array.isArray(list.items)) continue;
    const weight = Number.isFinite(list.weight) ? (list.weight as number) : 1;
    if (weight <= 0) continue;

    for (let index = 0; index < list.items.length; index++) {
      const item = list.items[index]!;
      let key: string;
      try {
        key = identity(item);
      } catch {
        continue;
      }
      if (!key) continue;

      const rank = index + 1;
      const contribution = weight / (k + rank);
      const existing = fused.get(key);
      if (existing) {
        existing.score += contribution;
        if (!existing.sources.includes(list.source)) existing.sources.push(list.source);
        if (rank < existing.bestRank) existing.bestRank = rank;
        continue;
      }
      fused.set(key, { item, score: contribution, sources: [list.source], bestRank: rank });
    }
  }

  const out = [...fused.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Equal fused scores: the one a source ranked higher wins, then the one more sources found.
    if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
    return b.sources.length - a.sources.length;
  });

  return options.limit && options.limit > 0 ? out.slice(0, options.limit) : out;
}

/**
 * How many independent sources returned this result.
 *
 * Worth surfacing rather than hiding inside the score: a track four sources agree on is a
 * different kind of answer from one a single scraper produced, and a UI can say so.
 */
export function fusionConsensus<T>(result: FusedResult<T>): number {
  return result.sources.length;
}
