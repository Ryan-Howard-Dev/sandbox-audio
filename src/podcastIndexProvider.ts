/**
 * Podcast Index (podcastindex.org) search provider — optional, key-gated.
 *
 * Why optional rather than an embedded app key: Podcast Index issues keys per-APP and their
 * terms state they monitor and enforce rate limits. A key compiled into the APK would put
 * every install on one shared quota under one account, is extractable from the binary, and
 * a single throttle would break podcast search for everyone at once. The keyless iTunes
 * path already works, so PI is treated as a coverage UPGRADE the user can opt into with
 * their own credentials — not as load-bearing infrastructure.
 *
 * Attribution: podcastindex.org's terms ask for credit when you use the API. See
 * PODCAST_INDEX_ATTRIBUTION and render it wherever PI results are shown.
 */

import { loadSecret, saveSecret } from './securitySettings';
import { isAirGapEnabled } from './airGapMode';
import { fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';
import type { PodcastCatalogShow } from './podcastCatalog';

export const PODCAST_INDEX_KEY = 'sandbox_podcastindex_key';
export const PODCAST_INDEX_SECRET = 'sandbox_podcastindex_secret';

/** Required by podcastindex.org's terms of service when using their API. */
export const PODCAST_INDEX_ATTRIBUTION = 'Podcast search by Podcast Index';

const API_BASE = 'https://api.podcastindex.org/api/1.0';
const TIMEOUT_MS = 9000;
const USER_AGENT = 'SandboxAudio/1.0';

export interface PodcastIndexCredentials {
  key: string;
  secret: string;
}

export function loadPodcastIndexCredentials(): PodcastIndexCredentials {
  return {
    key: loadSecret(PODCAST_INDEX_KEY).trim(),
    secret: loadSecret(PODCAST_INDEX_SECRET).trim(),
  };
}

export function savePodcastIndexCredentials(creds: Partial<PodcastIndexCredentials>): void {
  if (creds.key !== undefined) saveSecret(PODCAST_INDEX_KEY, creds.key.trim());
  if (creds.secret !== undefined) saveSecret(PODCAST_INDEX_SECRET, creds.secret.trim());
}

/** True when the user has supplied their own credentials. */
export function isPodcastIndexAvailable(): boolean {
  const { key, secret } = loadPodcastIndexCredentials();
  return Boolean(key && secret) && !isAirGapEnabled();
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Podcast Index auth: sha1(key + secret + unix seconds), sent with the key and the same
 * timestamp so the server can recompute it. Uses Web Crypto, which the Android WebView has.
 */
export async function podcastIndexAuthHeaders(
  creds: PodcastIndexCredentials,
  now = Date.now(),
): Promise<Record<string, string>> {
  const seconds = Math.floor(now / 1000);
  const payload = `${creds.key}${creds.secret}${seconds}`;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(payload));
  return {
    'X-Auth-Key': creds.key,
    'X-Auth-Date': String(seconds),
    Authorization: toHex(digest),
    'User-Agent': USER_AGENT,
  };
}

interface PiFeed {
  id?: number;
  title?: string;
  author?: string;
  ownerName?: string;
  description?: string;
  url?: string;
  originalUrl?: string;
  image?: string;
  artwork?: string;
  episodeCount?: number;
}

function piFeedToShow(feed: PiFeed): PodcastCatalogShow | null {
  const feedUrl = (feed.url ?? feed.originalUrl ?? '').trim();
  const title = feed.title?.trim();
  if (!feedUrl || !title) return null;
  return {
    id: `podcastindex-${feed.id ?? feedUrl}`,
    title,
    author: (feed.author ?? feed.ownerName ?? '').trim(),
    description: feed.description?.trim(),
    feedUrl,
    artworkUrl: (feed.artwork ?? feed.image ?? '').trim() || undefined,
    episodeCount: feed.episodeCount,
    source: 'podcastindex',
  };
}

/**
 * Search shows via Podcast Index. Returns [] (never throws) when unavailable, throttled or
 * unconfigured so callers can fall through to the keyless iTunes path.
 */
export async function searchPodcastIndexShows(
  query: string,
  limit = 25,
): Promise<PodcastCatalogShow[]> {
  const q = query.trim();
  if (q.length < 2 || !isPodcastIndexAvailable()) return [];
  const creds = loadPodcastIndexCredentials();

  try {
    const headers = await podcastIndexAuthHeaders(creds);
    const url = `${API_BASE}/search/byterm?q=${encodeURIComponent(q)}&max=${limit}`;
    const res = await fetchWithTimeout(url, { headers }, TIMEOUT_MS);
    // 401 = bad credentials, 429 = throttled. Both mean "quietly use iTunes instead".
    if (!res.ok) return [];
    if (!isJsonLikeContentType(res.headers.get('content-type') ?? '')) return [];
    const data = (await res.json()) as { feeds?: PiFeed[] };
    const shows: PodcastCatalogShow[] = [];
    for (const feed of data.feeds ?? []) {
      const show = piFeedToShow(feed);
      if (show) shows.push(show);
    }
    return shows;
  } catch {
    return [];
  }
}

/** Verify credentials so Settings can show a pass/fail rather than failing silently. */
export async function testPodcastIndexCredentials(
  creds: PodcastIndexCredentials = loadPodcastIndexCredentials(),
): Promise<{ ok: boolean; detail: string }> {
  if (!creds.key || !creds.secret) {
    return { ok: false, detail: 'Key and secret required' };
  }
  try {
    const headers = await podcastIndexAuthHeaders(creds);
    const res = await fetchWithTimeout(`${API_BASE}/search/byterm?q=test&max=1`, { headers }, TIMEOUT_MS);
    if (res.status === 401) return { ok: false, detail: 'Rejected — check key and secret' };
    if (res.status === 429) return { ok: false, detail: 'Rate limited — try again later' };
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: 'Connected' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Request failed' };
  }
}
