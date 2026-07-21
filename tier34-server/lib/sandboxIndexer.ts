/**
 * Sandbox Indexer — built-in Prowlarr-lite for tier34.
 * Combines yt-dlp, Archive.org, optional user Torznab/Jackett endpoints, and external Prowlarr fallback.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import { resolveProxyCandidates, ytdlpAvailable } from './proxyResolve.js';
import { searchArchiveTier, searchDebridTier, searchProxyTier } from './search.js';

export interface TorznabEndpoint {
  name: string;
  /** Full Torznab search URL template or base; {query} and {apikey} placeholders supported. */
  url: string;
  apiKey?: string;
}

export interface SandboxIndexerConfig {
  version: 1;
  torznabEndpoints: TorznabEndpoint[];
  updatedAt: number;
}

export interface IndexerHit {
  id: string;
  title: string;
  artist: string;
  url: string;
  magnetUrl?: string;
  downloadUrl?: string;
  durationSeconds: number;
  sourceId: string;
  source: 'ytdlp' | 'archive' | 'torznab' | 'prowlarr' | 'magnet';
  artworkUrl?: string;
  releaseYear?: string;
  resolveHint?: string;
  sizeBytes?: number;
}

const CONFIG_FILE = join(LOCKER_STORAGE_ROOT, 'indexer-config.json');

function emptyConfig(): SandboxIndexerConfig {
  return { version: 1, torznabEndpoints: [], updatedAt: 0 };
}

export function loadIndexerConfig(): SandboxIndexerConfig {
  if (!existsSync(CONFIG_FILE)) return emptyConfig();
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as SandboxIndexerConfig;
    return {
      version: 1,
      torznabEndpoints: Array.isArray(parsed.torznabEndpoints) ? parsed.torznabEndpoints : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return emptyConfig();
  }
}

export function saveIndexerConfig(patch: Partial<Pick<SandboxIndexerConfig, 'torznabEndpoints'>>): SandboxIndexerConfig {
  const existing = loadIndexerConfig();
  const next: SandboxIndexerConfig = {
    version: 1,
    torznabEndpoints: patch.torznabEndpoints ?? existing.torznabEndpoints,
    updatedAt: Date.now(),
  };
  mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

const BTIH_HEX_RE = /\b([0-9a-fA-F]{40})\b/;

/** Extract a 40-char BTIH hex hash from a bare hash, magnet link, or surrounding text. */
export function extractInfoHash(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const fromMagnet = t.match(/xt=urn:btih:([0-9a-fA-F]{40})/i)?.[1];
  if (fromMagnet) return fromMagnet.toLowerCase();
  if (/^[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase();
  const embedded = t.match(BTIH_HEX_RE)?.[1];
  return embedded ? embedded.toLowerCase() : null;
}

/** Build a BTIH magnet URI from a torrent info hash (optionally with display name). */
export function infoHashToMagnet(hash: string, displayName?: string): string {
  const h = hash.trim().toLowerCase();
  let magnet = `magnet:?xt=urn:btih:${h}`;
  const name = displayName?.trim();
  if (name) magnet += `&dn=${encodeURIComponent(name)}`;
  return magnet;
}

/** Normalize magnet, torrent URL, or bare info hash into a magnet/torrent link for indexer flows. */
export function normalizeTorrentInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isMagnetOrTorrentUrl(t)) return t;
  const hash = extractInfoHash(t);
  if (hash) return infoHashToMagnet(hash);
  return null;
}

export function isMagnetOrTorrentUrl(raw: string): boolean {
  const t = raw.trim();
  return (
    t.startsWith('magnet:') ||
    /\.torrent(\?|$)/i.test(t) ||
    (t.startsWith('http') && t.includes('magnet:?xt='))
  );
}

/** True when input is a magnet/torrent URL or a bare BTIH info hash (with optional surrounding text). */
export function isTorrentResolvableInput(raw: string): boolean {
  return isMagnetOrTorrentUrl(raw) || extractInfoHash(raw) !== null;
}

function parseTitleArtist(raw: string, query: string): { title: string; artist: string } {
  const cleaned = raw.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { title: cleaned || query, artist: 'Unknown' };
}

function queryRelevance(title: string, artist: string, query: string): number {
  const hay = `${title} ${artist}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

function rankHits(hits: IndexerHit[], query: string): IndexerHit[] {
  const seen = new Set<string>();
  return hits
    .filter((h) => h.url?.trim() && queryRelevance(h.title, h.artist, query) >= 0.35)
    .sort(
      (a, b) =>
        queryRelevance(b.title, b.artist, query) - queryRelevance(a.title, a.artist, query),
    )
    .filter((h) => {
      const k = `${h.title}::${h.artist}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function buildTorznabUrl(endpoint: TorznabEndpoint, query: string): string {
  const key = endpoint.apiKey?.trim() ?? '';
  let url = endpoint.url.trim();
  if (url.includes('{query}')) {
    return url.replace(/\{query\}/g, encodeURIComponent(query)).replace(/\{apikey\}/g, key);
  }
  const sep = url.includes('?') ? '&' : '?';
  const params = new URLSearchParams({ t: 'search', q: query });
  if (key) params.set('apikey', key);
  return `${url}${sep}${params.toString()}`;
}

interface TorznabItem {
  title?: string;
  link?: string;
  magnetUrl?: string;
  size?: number;
  guid?: string;
}

/** Parse minimal Torznab/Newznab XML — Jackett and Prowlarr both emit this shape. */
function parseTorznabXml(xml: string): TorznabItem[] {
  const items: TorznabItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    const guid = block.match(/<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i)?.[1]?.trim();
    const sizeRaw = block.match(/<size>(\d+)<\/size>/i)?.[1];
    const enclosure = block.match(/url="(magnet:[^"]+)"/i)?.[1];
    const magnet = enclosure ?? (link?.startsWith('magnet:') ? link : undefined);
    items.push({
      title,
      link,
      magnetUrl: magnet,
      size: sizeRaw ? Number(sizeRaw) : undefined,
      guid,
    });
  }
  return items;
}

async function searchTorznabEndpoint(
  endpoint: TorznabEndpoint,
  query: string,
): Promise<IndexerHit[]> {
  const url = buildTorznabUrl(endpoint, query);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'application/xml, application/rss+xml, */*' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const text = await res.text();
  const items = parseTorznabXml(text);
  const out: IndexerHit[] = [];
  for (const item of items.slice(0, 8)) {
    const magnet = item.magnetUrl ?? (item.link?.startsWith('magnet:') ? item.link : undefined);
    const download = item.link && !item.link.startsWith('magnet:') ? item.link : undefined;
    const resolved = magnet ?? download;
    if (!resolved || !item.title) continue;
    const { title, artist } = parseTitleArtist(item.title, query);
    out.push({
      id: `idx-tzn-${out.length}-${item.guid?.slice(0, 8) ?? 'x'}`,
      title,
      artist,
      url: resolved,
      magnetUrl: magnet,
      downloadUrl: download,
      durationSeconds: 0,
      sourceId: item.guid ?? item.title,
      source: 'torznab',
      sizeBytes: item.size,
      resolveHint: `torznab:${endpoint.name}:${item.guid ?? item.title}`,
    });
  }
  return out;
}

interface ProwlarrResult {
  title?: string;
  guid?: string;
  downloadUrl?: string;
  magnetUrl?: string;
  size?: number;
}

async function searchProwlarr(
  baseUrl: string,
  apiKey: string,
  query: string,
): Promise<IndexerHit[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/search?query=${encodeURIComponent(query)}&type=search`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as ProwlarrResult[];
  if (!Array.isArray(data)) return [];
  const out: IndexerHit[] = [];
  for (const hit of data.slice(0, 8)) {
    const magnet = hit.magnetUrl ?? hit.downloadUrl ?? hit.guid;
    if (!magnet || !hit.title) continue;
    const { title, artist } = parseTitleArtist(hit.title, query);
    out.push({
      id: `idx-prw-${out.length}`,
      title,
      artist,
      url: magnet,
      magnetUrl: hit.magnetUrl ?? (magnet.startsWith('magnet:') ? magnet : undefined),
      downloadUrl: hit.downloadUrl,
      durationSeconds: 0,
      sourceId: hit.guid ?? hit.title,
      source: 'prowlarr',
      sizeBytes: hit.size,
      resolveHint: `prowlarr:${hit.guid ?? 'torrent'}`,
    });
  }
  return out;
}

async function searchYtdlp(query: string): Promise<IndexerHit[]> {
  const rows = await resolveProxyCandidates(query);
  return rows.map((row, i) => ({
    id: row.id.replace(/^proxy-/, 'idx-yt-') || `idx-yt-${i}`,
    title: row.title,
    artist: row.artist,
    url: row.url,
    durationSeconds: row.durationSeconds,
    sourceId: row.sourceId,
    source: 'ytdlp' as const,
    artworkUrl: row.artworkUrl,
    releaseYear: row.releaseYear,
    resolveHint: row.resolveHint ?? `ytdlp:${row.sourceId}`,
  }));
}

async function searchArchive(query: string, losslessBias = false): Promise<IndexerHit[]> {
  const rows = losslessBias
    ? await searchDebridTier(query)
    : await searchArchiveTier(query, false);
  return rows.map((row, i) => ({
    id: row.envelopeId.replace(/^tier34-/, 'idx-arch-') || `idx-arch-${i}`,
    title: row.title,
    artist: row.artist,
    url: row.url,
    durationSeconds: row.durationSeconds,
    sourceId: row.sourceId,
    source: 'archive' as const,
    artworkUrl: row.artworkUrl,
    releaseYear: row.releaseYear,
    resolveHint: row.resolveHint ?? `arch:${row.sourceId}`,
  }));
}

export type TorrentSearchOptions = {
  query: string;
  prowlarrUrl?: string;
  prowlarrApiKey?: string;
};

/**
 * Torrent/magnet search — Prowlarr when configured, else built-in Torznab endpoints.
 * Does not include yt-dlp or archive (use searchSandboxIndexer for unified results).
 */
export async function searchTorrentHits(options: TorrentSearchOptions): Promise<IndexerHit[]> {
  const q = options.query.trim();
  if (!q) return [];

  const prowlarrUrl =
    options.prowlarrUrl?.trim() || process.env.PROWLARR_URL?.trim() || '';
  const prowlarrKey =
    options.prowlarrApiKey?.trim() || process.env.PROWLARR_API_KEY?.trim() || '';

  if (prowlarrKey && prowlarrUrl) {
    try {
      const hits = await searchProwlarr(prowlarrUrl, prowlarrKey, q);
      if (hits.length > 0) return rankHits(hits, q).slice(0, 8);
    } catch (e) {
      console.warn('[sandbox-indexer] prowlarr', e);
    }
  }

  const config = loadIndexerConfig();
  const torznabHits: IndexerHit[] = [];
  for (const endpoint of config.torznabEndpoints) {
    if (!endpoint.url?.trim()) continue;
    try {
      const hits = await searchTorznabEndpoint(endpoint, q);
      torznabHits.push(...hits);
    } catch (e) {
      console.warn(`[sandbox-indexer] torznab ${endpoint.name}`, e);
    }
  }
  if (torznabHits.length > 0) return rankHits(torznabHits, q).slice(0, 8);

  return [];
}

export type UnifiedSearchOptions = TorrentSearchOptions & {
  /** Include proxy-tier sources (yt-dlp, archive catalog). Default true. */
  includeProxy?: boolean;
  /** Prefer FLAC archive bias for debrid-style results. Default false. */
  losslessBias?: boolean;
};

/** Unified indexer search — all built-in sources + optional external Prowlarr. */
export async function searchSandboxIndexer(options: UnifiedSearchOptions): Promise<IndexerHit[]> {
  const q = options.query.trim();
  if (!q) return [];

  const torrentLink = normalizeTorrentInput(q);
  if (torrentLink) {
    const { title, artist } = parseTitleArtist(torrentLink.slice(0, 80), q);
    return [
      {
        id: 'idx-magnet-direct',
        title,
        artist,
        url: torrentLink,
        magnetUrl: torrentLink.startsWith('magnet:') ? torrentLink : undefined,
        downloadUrl: torrentLink.startsWith('http') ? torrentLink : undefined,
        durationSeconds: 0,
        sourceId: extractInfoHash(q) ?? 'direct',
        source: 'magnet',
        resolveHint: 'magnet:direct',
      },
    ];
  }

  const includeProxy = options.includeProxy !== false;
  const tasks: Promise<IndexerHit[]>[] = [];

  if (includeProxy) {
    tasks.push(searchYtdlp(q));
    tasks.push(searchArchive(q, false));
  }
  tasks.push(searchArchive(q, options.losslessBias ?? false));
  tasks.push(searchTorrentHits(options));

  const batches = await Promise.all(tasks);
  return rankHits(batches.flat(), q).slice(0, 12);
}

export async function getIndexerStatus(): Promise<{
  builtIn: { ytdlp: boolean; archive: boolean };
  torznabEndpoints: number;
  prowlarrConfigured: boolean;
  sources: string[];
}> {
  const ytdlp = await ytdlpAvailable();
  const config = loadIndexerConfig();
  const prowlarrKey = process.env.PROWLARR_API_KEY?.trim() ?? '';
  const sources = ['archive.org'];
  if (ytdlp) sources.push('yt-dlp');
  if (config.torznabEndpoints.length > 0) sources.push('torznab');
  if (prowlarrKey) sources.push('prowlarr');

  return {
    builtIn: { ytdlp, archive: true },
    torznabEndpoints: config.torznabEndpoints.length,
    prowlarrConfigured: Boolean(prowlarrKey),
    sources,
  };
}

/** Lightweight proxy-tier search wrapper for health checks. */
export async function searchSandboxIndexerProxy(query: string): Promise<IndexerHit[]> {
  const [ytdlp, arch] = await Promise.all([searchYtdlp(query), searchArchive(query, false)]);
  return rankHits([...ytdlp, ...arch], query).slice(0, 8);
}

export { searchProxyTier, searchDebridTier };
