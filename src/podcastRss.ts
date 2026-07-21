import { isAirGapEnabled } from './airGapMode';
import { isCapacitorNative } from './platformEnv';
import { fetchMirroredPodcastFeedXml } from './podcastMirrorSync';
import { getTier34BaseUrl, getTier34LanBaseUrl, isTier34ReachableCached } from './tier34/client';
import { fetchYoutubePodcastFeed, isYoutubePodcastListUrl } from './podcastYoutube';
import {
  subscriptionFeedUrlId,
  type PodcastEpisode,
  type PodcastSubscription,
} from './podcastStorage';

export interface ParsedPodcastFeed {
  subscription: Omit<PodcastSubscription, 'subscribedAt'>;
  episodes: PodcastEpisode[];
}

function textContent(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

function longestText(...candidates: Array<string | undefined>): string | undefined {
  let best = '';
  for (const raw of candidates) {
    const t = raw?.trim();
    if (!t) continue;
    if (t.length > best.length) best = t;
  }
  return best || undefined;
}

function episodeDescriptionFromItem(item: Element): string | undefined {
  const encodedEl =
    item.querySelector('content\\:encoded') ??
    item.querySelector('encoded') ??
    item.querySelector('[*|encoded]');
  return longestText(
    textContent(encodedEl),
    textContent(item.querySelector('description')),
    textContent(item.querySelector('itunes\\:summary, summary')),
    textContent(item.querySelector('itunes\\:subtitle, subtitle')),
  );
}

function atomEntryDescription(entry: Element): string | undefined {
  const content = entry.querySelector('content');
  const contentType = content?.getAttribute('type')?.toLowerCase() ?? '';
  const fromContent =
    contentType.includes('html') || contentType.includes('xml')
      ? textContent(content)
      : textContent(content);
  return longestText(
    fromContent,
    textContent(entry.querySelector('summary')),
    textContent(entry.querySelector('subtitle')),
  );
}

function attr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name)?.trim() ?? '';
}

function parseDuration(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function parseDate(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function episodeIdFromGuid(feedId: string, guid: string, audioUrl: string): string {
  const base = guid.trim() || audioUrl.trim();
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `${feedId}:ep-${Math.abs(hash).toString(36)}`;
}

function findEnclosure(item: Element): { url: string; type?: string } | null {
  const enclosure = item.querySelector('enclosure');
  const url = attr(enclosure, 'url');
  if (url) return { url, type: attr(enclosure, 'type') || undefined };
  const link = item.querySelector('link[rel="enclosure"], link[type^="audio"]');
  const linkUrl = attr(link, 'href');
  if (linkUrl) return { url: linkUrl, type: attr(link, 'type') || undefined };
  return null;
}

function findChaptersUrl(item: Element): string | undefined {
  const chaptersEl =
    item.querySelector('podcast\\:chapters, chapters') ??
    item.querySelector('[*|chapters]');
  const href = attr(chaptersEl, 'url') || attr(chaptersEl, 'href');
  return href || undefined;
}

function parseRssItems(
  doc: Document,
  feedUrl: string,
  feedId: string,
  channelArt?: string,
): ParsedPodcastFeed {
  const channel = doc.querySelector('channel');
  const title = textContent(channel?.querySelector('title')) || 'Podcast';
  const description =
    textContent(channel?.querySelector('description')) ||
    textContent(channel?.querySelector('itunes\\:summary, summary'));
  const artworkUrl =
    attr(channel?.querySelector('itunes\\:image, image'), 'href') ||
    textContent(channel?.querySelector('image > url')) ||
    channelArt;

  const episodes: PodcastEpisode[] = [];
  for (const item of Array.from(doc.querySelectorAll('item'))) {
    const enc = findEnclosure(item);
    if (!enc?.url) continue;
    const guid =
      textContent(item.querySelector('guid')) ||
      attr(item.querySelector('link'), 'href') ||
      enc.url;
    const epTitle = textContent(item.querySelector('title')) || 'Episode';
    const pubDate = parseDate(textContent(item.querySelector('pubDate')));
    const duration = parseDuration(
      textContent(item.querySelector('itunes\\:duration, duration')),
    );
    const epArt =
      attr(item.querySelector('itunes\\:image'), 'href') || artworkUrl || undefined;
    episodes.push({
      id: episodeIdFromGuid(feedId, guid, enc.url),
      feedId,
      title: epTitle,
      description: episodeDescriptionFromItem(item),
      audioUrl: enc.url,
      durationSeconds: duration,
      publishedAt: pubDate,
      artworkUrl: epArt,
      guid: guid.trim() || undefined,
      chaptersUrl: findChaptersUrl(item),
    });
  }

  return {
    subscription: {
      id: feedId,
      feedUrl,
      title,
      description: description || undefined,
      artworkUrl: artworkUrl || undefined,
      source: 'rss',
    },
    episodes: episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
  };
}

function parseAtomEntries(
  doc: Document,
  feedUrl: string,
  feedId: string,
): ParsedPodcastFeed {
  const feed = doc.querySelector('feed');
  const title = textContent(feed?.querySelector('title')) || 'Podcast';
  const description = textContent(feed?.querySelector('subtitle, summary'));
  const artworkUrl = attr(feed?.querySelector('logo, icon'), 'href') || undefined;

  const episodes: PodcastEpisode[] = [];
  for (const entry of Array.from(doc.querySelectorAll('entry'))) {
    const links = Array.from(entry.querySelectorAll('link'));
    const audioLink =
      links.find((l) => (l.getAttribute('type') ?? '').startsWith('audio')) ??
      links.find((l) => l.getAttribute('rel') === 'enclosure');
    const audioUrl = attr(audioLink, 'href');
    if (!audioUrl) continue;
    const guid =
      textContent(entry.querySelector('id')) ||
      attr(entry.querySelector('link'), 'href') ||
      audioUrl;
    const epTitle = textContent(entry.querySelector('title')) || 'Episode';
    const pubDate = parseDate(textContent(entry.querySelector('published, updated')));
    const duration = parseDuration(
      textContent(entry.querySelector('itunes\\:duration, duration')),
    );
    episodes.push({
      id: episodeIdFromGuid(feedId, guid, audioUrl),
      feedId,
      title: epTitle,
      description: atomEntryDescription(entry),
      audioUrl,
      durationSeconds: duration,
      publishedAt: pubDate,
      artworkUrl: artworkUrl || undefined,
      guid: guid.trim() || undefined,
      chaptersUrl: findChaptersUrl(entry),
    });
  }

  return {
    subscription: {
      id: feedId,
      feedUrl,
      title,
      description: description || undefined,
      artworkUrl,
      source: 'rss',
    },
    episodes: episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
  };
}

export function parsePodcastFeedXml(xml: string, feedUrl: string): ParsedPodcastFeed {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const feedId = subscriptionFeedUrlId(feedUrl);
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid feed XML');
  }
  if (doc.querySelector('feed')) {
    return parseAtomEntries(doc, feedUrl, feedId);
  }
  return parseRssItems(doc, feedUrl, feedId);
}

async function fetchViaDevProxy(feedUrl: string): Promise<string> {
  const res = await fetch(`/api/podcast-feed?url=${encodeURIComponent(feedUrl)}`);
  if (!res.ok) throw new Error(`Feed proxy error (${res.status})`);
  return res.text();
}

async function fetchViaTier34(feedUrl: string): Promise<string | null> {
  const base = getTier34BaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(
      `${base.replace(/\/$/, '')}/api/podcast-feed?url=${encodeURIComponent(feedUrl)}`,
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

export async function fetchPodcastFeed(feedUrl: string): Promise<ParsedPodcastFeed> {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new Error('Feed URL required');
  if (isYoutubePodcastListUrl(trimmed)) {
    if (isAirGapEnabled()) {
      throw new Error('Video-channel podcasts require WAN — not available in Air-Gap Mode.');
    }
    return fetchYoutubePodcastFeed(trimmed);
  }

  if (isAirGapEnabled()) {
    const mirrored = await fetchMirroredPodcastFeedXml(trimmed);
    if (mirrored) {
      return parsePodcastFeedXml(mirrored, trimmed);
    }
    throw new Error(
      'Podcast not mirrored on Sandbox Server yet. Sync subscriptions while online, wait for Tier34 mirror pull, then retry in Air-Gap Mode.',
    );
  }

  let xml: string | null = await fetchViaTier34(trimmed);
  if (!xml) {
    try {
      const direct = await fetch(trimmed, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
      if (direct.ok) xml = await direct.text();
    } catch {
      /* CORS — fall through to dev proxy */
    }
  }
  if (!xml) xml = await fetchViaDevProxy(trimmed);
  return parsePodcastFeedXml(xml, trimmed);
}

function isYoutubeWatchUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return /youtube\.com|youtu\.be/i.test(url);
  }
}

/** Unwrap Sandbox proxy wrappers to the original enclosure HTTPS URL. */
export function unwrapPodcastEnclosureUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(
      trimmed,
      typeof window !== 'undefined' ? window.location.origin : 'https://localhost',
    );
    if (
      parsed.pathname.includes('/api/proxy/stream') ||
      parsed.pathname.includes('/api/podcast-audio-proxy') ||
      parsed.pathname.includes('/audio-proxy')
    ) {
      const inner = parsed.searchParams.get('url');
      if (inner) {
        const decoded = decodeURIComponent(inner).trim();
        if (decoded) return decoded;
      }
    }
  } catch {
    /* ignore malformed URL */
  }
  return trimmed;
}

/** Like podcastPlaybackUrl but never throws — safe for React render paths. */
export function safePodcastPlaybackUrl(rawUrl: string): string {
  if (!rawUrl?.trim()) return '';
  try {
    return podcastPlaybackUrl(rawUrl);
  } catch (err) {
    console.warn('[podcastRss] safePodcastPlaybackUrl failed:', err);
    return unwrapPodcastEnclosureUrl(rawUrl);
  }
}

export function podcastPlaybackUrl(rawUrl: string): string {
  if (!rawUrl?.trim()) return rawUrl;
  let trimmed = rawUrl.trim();
  if (typeof window === 'undefined') return trimmed;
  if (trimmed.startsWith('blob:')) return trimmed;

  // Never hand ExoPlayer a Capacitor localhost proxy — unwrap to direct enclosure HTTPS.
  if (
    isCapacitorNative() &&
    (trimmed.startsWith('/api/') ||
      trimmed.includes('/api/podcast-audio-proxy') ||
      trimmed.includes('/api/proxy/stream'))
  ) {
    const absolute = trimmed.startsWith('/')
      ? `${window.location.origin}${trimmed}`
      : trimmed;
    const enclosure = unwrapPodcastEnclosureUrl(absolute);
    if (/^https?:\/\//i.test(enclosure) && enclosure !== absolute) {
      trimmed = enclosure;
    }
  }

  if (trimmed.startsWith('/api/podcast-audio-proxy') || trimmed.startsWith('/audio-proxy')) {
    if (isCapacitorNative() && typeof window !== 'undefined') {
      const enclosure = unwrapPodcastEnclosureUrl(`${window.location.origin}${trimmed}`);
      if (/^https?:\/\//i.test(enclosure)) return enclosure;
      return `${window.location.origin}${trimmed}`;
    }
    return trimmed;
  }
  const tier34Lan = getTier34LanBaseUrl()?.replace(/\/$/, '') ?? '';
  const tier34 = getTier34BaseUrl()?.replace(/\/$/, '') ?? '';
  if (trimmed.includes('/api/locker/blob/')) {
    try {
      const parsed = new URL(trimmed, tier34Lan || tier34 || 'http://sandbox.local');
      if (parsed.pathname.includes('/api/locker/blob/')) {
        const base = tier34Lan || tier34;
        if (base) return `${base}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      if (tier34Lan && trimmed.startsWith('/api/locker/blob/')) {
        return `${tier34Lan}${trimmed}`;
      }
    }
  }
  if (isYoutubeWatchUrl(trimmed)) {
    if (!tier34 || !isTier34ReachableCached()) {
      throw new Error('Sandbox Server required for video-channel podcast playback');
    }
    return `${tier34}/api/proxy/stream?url=${encodeURIComponent(trimmed)}`;
  }
  if (tier34 && isTier34ReachableCached()) {
    return `${tier34}/api/proxy/stream?url=${encodeURIComponent(trimmed)}`;
  }
  // Native ExoPlayer cannot play Vite-relative proxy URLs — use direct enclosure HTTPS.
  if (isCapacitorNative() && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `/api/podcast-audio-proxy?url=${encodeURIComponent(trimmed)}`;
}
