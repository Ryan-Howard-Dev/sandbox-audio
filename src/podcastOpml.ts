import { isAirGapEnabled } from './airGapMode';
import { fetchPodcastFeed } from './podcastRss';
import {
  addSubscription,
  saveEpisodesForFeed,
  subscriptionFeedUrlId,
  type PodcastSubscription,
} from './podcastStorage';
import { onPodcastEpisodesUpdated } from './podcastEpisodeSync';

export interface OpmlImportResult {
  imported: PodcastSubscription[];
  skipped: number;
  failed: { feedUrl: string; error: string }[];
}

function textContent(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

function attr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name)?.trim() ?? '';
}

export function parseOpmlFeedUrls(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid OPML XML');
  }
  const urls = new Set<string>();
  for (const outline of Array.from(doc.querySelectorAll('outline'))) {
    const xmlUrl = attr(outline, 'xmlUrl') || attr(outline, 'xmlurl');
    if (xmlUrl) urls.add(xmlUrl);
    const type = attr(outline, 'type').toLowerCase();
    if (type === 'rss' || type === 'atom') {
      const href = attr(outline, 'url');
      if (href && /\.xml$|\/feed/i.test(href)) urls.add(href);
    }
  }
  return [...urls];
}

export async function importPodcastOpml(xml: string): Promise<OpmlImportResult> {
  if (isAirGapEnabled()) {
    throw new Error('OPML import is disabled while Air-Gap Mode is active.');
  }
  const feedUrls = parseOpmlFeedUrls(xml);
  const imported: PodcastSubscription[] = [];
  const failed: OpmlImportResult['failed'] = [];
  let skipped = 0;

  for (const feedUrl of feedUrls) {
    const feedId = subscriptionFeedUrlId(feedUrl);
    try {
      const parsed = await fetchPodcastFeed(feedUrl);
      const existing = addSubscription({
        ...parsed.subscription,
        id: feedId,
        feedUrl,
        subscribedAt: Date.now(),
        lastFetchedAt: Date.now(),
      });
      if (existing.subscribedAt !== Date.now() && existing.lastFetchedAt) {
        skipped += 1;
      }
      saveEpisodesForFeed(existing.id, parsed.episodes);
      onPodcastEpisodesUpdated(existing.id, parsed.episodes);
      imported.push(existing);
    } catch (e) {
      failed.push({
        feedUrl,
        error: e instanceof Error ? e.message : 'Import failed',
      });
    }
  }

  return { imported, skipped, failed };
}
