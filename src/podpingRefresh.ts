/**
 * Podping wired to the podcast library.
 *
 * The watcher reports which followed feeds a publisher says have changed; this refetches exactly
 * those and nothing else. That is the whole value: instead of asking every subscription on a timer
 * whether anything happened, one stream says which one did, and a single feed is fetched in
 * response.
 *
 * Kept apart from both the watcher and the storage layer so the decision to refetch has one
 * obvious home. The watcher never fetches a feed; this module never talks to a chain.
 */

import { isAirGapEnabled } from './airGapMode';
import { fetchPodcastFeed } from './podcastRss';
import { loadSubscriptions, saveEpisodesForFeed } from './podcastStorage';
import { createPodpingWatcher, type HiveRpc, type PodpingWatcher } from './podpingWatcher';
import { HIVE_API_NODES } from './podpingWatcher';
import type { PodpingUpdate } from './podping';

/** Feed URLs of everything followed, for the watcher to filter the firehose against. */
export function subscribedFeedUrls(): string[] {
  return loadSubscriptions()
    .map((sub) => sub.feedUrl?.trim() ?? '')
    .filter((url) => url.length > 0);
}

/**
 * Refetch the feeds an announcement names.
 *
 * Matched back to the subscription by URL, because storage is keyed by subscription id while
 * Podping speaks in feed URLs. An announcement for something no longer followed is ignored rather
 * than fetched — subscriptions can be removed between the watcher reading them and this running.
 *
 * One failing feed must not stop the others: a publisher can announce a release seconds before
 * their CDN serves it, and that is a normal race, not an error worth abandoning the batch for.
 */
export async function refreshFeedsForUpdates(updates: PodpingUpdate[]): Promise<number> {
  if (isAirGapEnabled() || updates.length === 0) return 0;

  const byUrl = new Map<string, string>();
  for (const sub of loadSubscriptions()) {
    const url = sub.feedUrl?.trim();
    if (url) byUrl.set(url.replace(/\/+$/, '').toLowerCase(), sub.id);
  }

  let refreshed = 0;
  const done = new Set<string>();
  for (const update of updates) {
    const key = update.iri.replace(/\/+$/, '').toLowerCase();
    if (done.has(key)) continue;
    done.add(key);
    const feedId = byUrl.get(key);
    if (!feedId) continue;
    try {
      const parsed = await fetchPodcastFeed(update.iri);
      if (parsed.episodes.length > 0) {
        saveEpisodesForFeed(feedId, parsed.episodes);
        refreshed++;
      }
    } catch {
      /* announced before the CDN caught up, or a transient failure — the next tick will retry */
    }
  }
  return refreshed;
}

/** JSON-RPC over the public Hive nodes, rotating past any that fail. */
export function createHiveRpc(nodes: string[] = HIVE_API_NODES): HiveRpc {
  let index = 0;
  return async (method, params) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < nodes.length; attempt++) {
      const node = nodes[(index + attempt) % nodes.length]!;
      try {
        const response = await fetch(node, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (!response.ok) throw new Error(`hive ${response.status}`);
        const payload = (await response.json()) as { result?: unknown; error?: unknown };
        if (payload.error) throw new Error('hive rpc error');
        // Stick with whichever node answered, rather than retrying the dead one every call.
        index = (index + attempt) % nodes.length;
        return payload.result ?? null;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('all hive nodes failed');
  };
}

let watcher: PodpingWatcher | null = null;

/**
 * Start following the chain, if it is not already running and air-gap allows it.
 *
 * Deliberately explicit rather than automatic on import: a network connection should begin because
 * something decided to start it, at a point where air-gap has been read.
 */
export function startPodpingRefresh(rpc: HiveRpc = createHiveRpc()): PodpingWatcher | null {
  if (watcher || isAirGapEnabled()) return watcher;
  watcher = createPodpingWatcher({
    rpc,
    getSubscribedFeedUrls: subscribedFeedUrls,
    onUpdates: (updates) => {
      void refreshFeedsForUpdates(updates);
    },
  });
  void watcher.start();
  return watcher;
}

/** Stop and forget the watcher — used on teardown and when air-gap is switched on. */
export function stopPodpingRefresh(): void {
  watcher?.stop();
  watcher = null;
}
