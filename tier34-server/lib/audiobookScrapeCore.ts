/**
 * Shared scrape-index utilities and pure HTML/XML parsers for audiobook catalog providers.
 */

import type { AudiobookCatalogBook, AudiobookCatalogSource } from './audiobookRssCore.js';

export const SCRAPE_USER_AGENT = 'SandboxTier34/1.0';
export const SCRAPE_BROWSER_USER_AGENT =
  'Mozilla/5.0 (compatible; SandboxTier34/1.0; +https://github.com/)';
export const SCRAPE_INDEX_TTL_MS = 6 * 60 * 60_000;
export const SCRAPE_FETCH_DELAY_MS = 250;

export type ScrapeIndexEntry = {
  sourceId: string;
  title: string;
  author: string;
  url: string;
  artworkUrl?: string;
  description?: string;
};

type IndexCacheRow<T> = {
  builtAt: number;
  entries: T[];
};

const indexCaches = new Map<string, IndexCacheRow<ScrapeIndexEntry>>();

export function clearScrapeIndexCaches(): void {
  indexCaches.clear();
}

export function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function stripHtmlText(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  return decodeHtmlEntities(
    raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('just a moment') &&
    (lower.includes('cloudflare') || lower.includes('cf-chl'))
  );
}

export async function fetchScrapeHtml(
  url: string,
  opts?: { browserUa?: boolean; timeoutMs?: number },
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': opts?.browserUa ? SCRAPE_BROWSER_USER_AGENT : SCRAPE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (isCloudflareChallenge(text)) return null;
    return text;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOrBuildScrapeIndex(
  cacheKey: string,
  builder: () => Promise<ScrapeIndexEntry[]>,
  ttlMs = SCRAPE_INDEX_TTL_MS,
): Promise<ScrapeIndexEntry[]> {
  const cached = indexCaches.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < ttlMs) {
    return cached.entries;
  }
  const entries = await builder();
  indexCaches.set(cacheKey, { builtAt: Date.now(), entries });
  return entries;
}

function matchesQuery(text: string | undefined, qLower: string): boolean {
  if (!text?.trim()) return false;
  return text.toLowerCase().includes(qLower);
}

export function searchScrapeIndex(
  entries: ScrapeIndexEntry[],
  query: string,
  source: AudiobookCatalogSource,
  limit: number,
): AudiobookCatalogBook[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const qLower = q.toLowerCase();
  const out: AudiobookCatalogBook[] = [];
  for (const entry of entries) {
    if (
      !matchesQuery(entry.title, qLower) &&
      !matchesQuery(entry.author, qLower) &&
      !matchesQuery(entry.description, qLower)
    ) {
      continue;
    }
    out.push(scrapeEntryToBook(entry, source));
    if (out.length >= limit) break;
  }
  return out;
}

export function scrapeEntryToBook(
  entry: ScrapeIndexEntry,
  source: AudiobookCatalogSource,
): AudiobookCatalogBook {
  const idSuffix = entry.sourceId.includes('://') ? hashUrl(entry.url) : entry.sourceId;
  return {
    id: `${source}:${idSuffix}`,
    sourceId: entry.sourceId,
    title: entry.title,
    author: entry.author,
    description: entry.description,
    artworkUrl: entry.artworkUrl,
    source,
    detailUrl: entry.url,
  };
}

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function parseLearnoutloudCatalogPage(html: string): ScrapeIndexEntry[] {
  const out: ScrapeIndexEntry[] = [];
  const blockRe =
    /<div class="categ_sngl_ttl">([\s\S]*?)<div class="cl_b"><!-- --><\/div>\s*<\/div>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html)) !== null) {
    const chunk = block[1] ?? '';
    const urlMatch = chunk.match(
      /<a href="(https:\/\/www\.learnoutloud\.com\/Free-Audio-Video\/[^"]+)"[^>]*class="categorytitle1"\s*>([^<]+)<\/a>/i,
    );
    if (!urlMatch?.[1] || !urlMatch[2]) continue;
    const url = urlMatch[1].trim();
    const title = stripHtmlText(urlMatch[2]);
    const authorMatch = chunk.match(/<div class="under_ttl">\s*<br>\s*by\s+([^<]+)/i);
    const author = stripHtmlText(authorMatch?.[1]) || 'LearnOutLoud';
    const imgMatch = chunk.match(/<img src="([^"]+)"[^>]*alt="([^"]*)"/i);
    let artworkUrl = imgMatch?.[1]?.trim();
    if (artworkUrl?.startsWith('/')) {
      artworkUrl = `https://www.learnoutloud.com${artworkUrl}`;
    }
    const idMatch = url.match(/\/(\d+)\s*$/);
    if (!idMatch?.[1]) continue;
    const descMatch = chunk.match(/<p>\s*([\s\S]*?)<\/p>/i);
    out.push({
      sourceId: url,
      title,
      author,
      url,
      artworkUrl,
      description: stripHtmlText(descMatch?.[1]),
    });
  }
  return out;
}

export function parseLearnoutloudRssFeedUrl(html: string): string | null {
  const match = html.match(/podcaststream\/listen\.php\?url=([^&"]+)/i);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].trim());
}

export function parseLit2goBooksPage(html: string): ScrapeIndexEntry[] {
  const out: ScrapeIndexEntry[] = [];
  const seen = new Set<string>();
  const figureRe = /<figure>([\s\S]*?)<\/figure>/gi;
  let figure: RegExpExecArray | null;
  while ((figure = figureRe.exec(html)) !== null) {
    const chunk = figure[1] ?? '';
    const urlMatch = chunk.match(/href="(https:\/\/etc\.usf\.edu\/lit2go\/\d+\/[^"/]+\/)"/i);
    const titleMatch = chunk.match(/<figcaption class="title">\s*<a[^>]+>([^<]+)<\/a>/i);
    if (!urlMatch?.[1] || !titleMatch?.[1]) continue;
    const url = urlMatch[1].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    const authorMatch = chunk.match(/<figcaption class="author">\s*by\s*<a[^>]*>([^<]+)<\/a>/i);
    const thumbMatch = chunk.match(/data-src="([^"]+)"/i);
    const abstractMatch = chunk.match(/<figcaption class="abstract">\s*([\s\S]*?)<\/figcaption>/i);
    out.push({
      sourceId: url,
      title: stripHtmlText(titleMatch[1]),
      author: stripHtmlText(authorMatch?.[1]) || 'Lit2Go',
      url,
      artworkUrl: thumbMatch?.[1],
      description: stripHtmlText(abstractMatch?.[1]),
    });
  }
  return out;
}

export function parseLit2goBookChapterLinks(
  html: string,
): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const re = /<dt>\s*<a href="(https:\/\/etc\.usf\.edu\/lit2go\/[^"]+)">([^<]+)<\/a>\s*<\/dt>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out.push({ url: match[1]!.trim(), title: stripHtmlText(match[2]) });
  }
  return out;
}

export function parseLit2goChapterMp3(html: string): string | null {
  const match =
    html.match(/lit2go\/audio\/mp3\/[^"\s]+\.mp3/i) ??
    html.match(/src="(https:\/\/etc\.usf\.edu\/lit2go\/audio\/mp3\/[^"]+\.mp3)"/i);
  if (!match) return null;
  const url = match[1] ?? match[0];
  return url.startsWith('http') ? url : `https://etc.usf.edu/${url.replace(/^\//, '')}`;
}

export function parseSitemapLocs(xml: string, hostIncludes: string): ScrapeIndexEntry[] {
  const out: ScrapeIndexEntry[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const url = match[1]?.trim();
    if (!url || !url.includes(hostIncludes)) continue;
    const slug = url.replace(/\/$/, '').split('/').pop() ?? '';
    if (!slug || slug === 'xml') continue;
    out.push({
      sourceId: url,
      title: slugToTitle(slug.replace(/-audiobook$|-book$/i, '')),
      author: hostIncludes.includes('golden') ? 'Golden Audiobooks' : 'Audiobooks4Soul',
      url,
    });
  }
  return out;
}

export function parseGoldenSearchPage(html: string): ScrapeIndexEntry[] {
  const out: ScrapeIndexEntry[] = [];
  const re =
    /<a[^>]+href="(https:\/\/goldenaudiobooks\.com\/[^"/?#]+-[^"/?#]*\/?)"[^>]*rel="bookmark"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const url = match[1]!.endsWith('/') ? match[1]! : `${match[1]}/`;
    out.push({
      sourceId: url,
      title: stripHtmlText(match[2]),
      author: 'Golden Audiobooks',
      url,
    });
  }
  return out;
}

export function parseWordPressPostMp3s(html: string): Array<{ title: string; audioUrl: string }> {
  const out: Array<{ title: string; audioUrl: string }> = [];
  const seen = new Set<string>();
  const re =
    /<audio[^>]*class="wp-audio-shortcode"[^>]*>[\s\S]*?<source[^>]+src="([^"]+\.mp3[^"]*)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]!.split('?')[0]!.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    index += 1;
    const fileName = raw.split('/').pop()?.replace(/\.mp3$/i, '') ?? `Chapter ${index}`;
    out.push({ title: `Chapter ${fileName}`, audioUrl: raw });
  }
  if (out.length > 0) return out;

  const fallback = [...html.matchAll(/src="(https?:\/\/[^"]+\.mp3(?:\?[^"]*)?)"/gi)];
  for (const row of fallback) {
    const raw = row[1]!.split('?')[0]!.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    index += 1;
    out.push({ title: `Chapter ${index}`, audioUrl: raw });
  }
  return out;
}

export function parseAudiobooks4soulCatalogPage(html: string): ScrapeIndexEntry[] {
  const out: ScrapeIndexEntry[] = [];
  const re =
    /<a[^>]+href="(https:\/\/audiobooks4soul\.com\/[^"/?#]+\/?)"[^>]*>([^<]{3,120})<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const url = match[1]!.endsWith('/') ? match[1]! : `${match[1]}/`;
    if (url.includes('/category/') || url.includes('/tag/') || url.includes('/page/')) continue;
    const title = stripHtmlText(match[2]);
    if (!title || title.length < 3) continue;
    out.push({
      sourceId: url,
      title,
      author: 'Audiobooks4Soul',
      url,
    });
  }
  return out;
}
