/**
 * Pure audiobook search-plugin + magnet helpers (client + tier34).
 */

export type AudiobookSearchParserHint = 'html-links' | 'json' | 'custom';

/** User-configured search engine plugin (qBittorrent-style). */
export interface AudiobookSearchPlugin {
  id: string;
  name: string;
  enabled: boolean;
  /** URL template with %s or {query} placeholder. */
  searchUrlTemplate: string;
  parserHint?: AudiobookSearchParserHint;
  /** Regex for result rows (custom) or JSON array key (json). */
  resultSelector?: string;
  titlePattern?: string;
  magnetPattern?: string;
  torrentUrlPattern?: string;
}

export interface AcquireSearchHit {
  id: string;
  title: string;
  pluginId: string;
  pluginName: string;
  magnetUrl?: string;
  torrentUrl?: string;
  sizeBytes?: number;
}

export interface ResolvedAcquireFile {
  path: string;
  url: string;
  size?: number;
}

export interface ResolvedAcquire {
  title: string;
  infoHash?: string;
  files: ResolvedAcquireFile[];
  /** Server-side ingest folder after download (tier34). */
  importPath?: string;
}

export interface AudiobookAcquireResolver {
  resolveMagnet(magnet: string): Promise<ResolvedAcquire>;
  resolveTorrent(torrentUrl: string): Promise<ResolvedAcquire>;
  searchPlugins(query: string, plugins: AudiobookSearchPlugin[]): Promise<AcquireSearchHit[]>;
}

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [, a, b] = m.map(Number) as [unknown, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Public HTTPS only — search plugins are user responsibility; block SSRF targets. */
export function isAllowedSearchPluginUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  return true;
}

export function applySearchUrlTemplate(template: string, query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return template.replace(/\{query\}/g, encoded).replace(/%s/g, encoded);
}

export function validateAudiobookSearchPlugin(
  plugin: Partial<AudiobookSearchPlugin>,
): { ok: true; plugin: AudiobookSearchPlugin } | { ok: false; error: string } {
  const id = String(plugin.id ?? '').trim();
  const name = String(plugin.name ?? '').trim();
  const searchUrlTemplate = String(plugin.searchUrlTemplate ?? '').trim();
  if (!id) return { ok: false, error: 'Plugin id is required' };
  if (!name) return { ok: false, error: 'Plugin name is required' };
  if (name.length > 80) return { ok: false, error: 'Plugin name is too long' };
  if (!searchUrlTemplate) return { ok: false, error: 'Search URL template is required' };
  if (!searchUrlTemplate.includes('{query}') && !searchUrlTemplate.includes('%s')) {
    return { ok: false, error: 'URL template must include {query} or %s' };
  }
  const sampleUrl = applySearchUrlTemplate(searchUrlTemplate, 'test');
  if (!isAllowedSearchPluginUrl(sampleUrl.split('?')[0] ?? sampleUrl)) {
    // Allow query strings on allowed hosts — validate base by reconstructing without query issues
    try {
      const u = new URL(sampleUrl);
      if (!isAllowedSearchPluginUrl(`${u.protocol}//${u.host}`)) {
        return { ok: false, error: 'Search URL must be a public HTTPS endpoint' };
      }
    } catch {
      return { ok: false, error: 'Search URL template is not a valid URL' };
    }
  }
  return {
    ok: true,
    plugin: {
      id,
      name,
      enabled: plugin.enabled !== false,
      searchUrlTemplate,
      parserHint: plugin.parserHint,
      resultSelector: plugin.resultSelector?.trim() || undefined,
      titlePattern: plugin.titlePattern?.trim() || undefined,
      magnetPattern: plugin.magnetPattern?.trim() || undefined,
      torrentUrlPattern: plugin.torrentUrlPattern?.trim() || undefined,
    },
  };
}

const BTIH_HEX_RE = /\b([0-9a-fA-F]{40})\b/;

export function extractInfoHash(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const fromMagnet = t.match(/xt=urn:btih:([0-9a-fA-F]{40})/i)?.[1];
  if (fromMagnet) return fromMagnet.toLowerCase();
  if (/^[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase();
  const embedded = t.match(BTIH_HEX_RE)?.[1];
  return embedded ? embedded.toLowerCase() : null;
}

export function infoHashToMagnet(hash: string, displayName?: string): string {
  const h = hash.trim().toLowerCase();
  let magnet = `magnet:?xt=urn:btih:${h}`;
  const name = displayName?.trim();
  if (name) magnet += `&dn=${encodeURIComponent(name)}`;
  return magnet;
}

export function normalizeMagnetOrTorrentInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith('magnet:')) return t;
  if (/\.torrent(\?|$)/i.test(t)) return t;
  const hash = extractInfoHash(t);
  if (hash) return infoHashToMagnet(hash);
  return null;
}

function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern?.trim()) return null;
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractWithPattern(block: string, pattern: string | undefined): string | undefined {
  const re = safeRegex(pattern);
  if (!re) return undefined;
  const m = re.exec(block);
  return m?.[1]?.trim() || m?.[0]?.trim() || undefined;
}

function parseHtmlLinks(body: string): Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> {
  const magnets = [...body.matchAll(/href=["'](magnet:[^"']+)["']/gi)].map((m) => m[1]!);
  const torrents = [...body.matchAll(/href=["'](https?:\/\/[^"']+\.torrent[^"']*)["']/gi)].map(
    (m) => m[1]!,
  );
  const titles = [...body.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) =>
    stripHtml(decodeHtmlEntities(m[1] ?? '')),
  );
  const defaultTitle = titles[0] || 'Torrent';
  const rows: Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> = [];
  const seen = new Set<string>();
  for (const magnet of magnets) {
    if (seen.has(magnet)) continue;
    seen.add(magnet);
    rows.push({ title: defaultTitle, magnetUrl: magnet });
  }
  for (const torrent of torrents) {
    if (seen.has(torrent)) continue;
    seen.add(torrent);
    rows.push({ title: defaultTitle, torrentUrl: torrent });
  }
  return rows;
}

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function getJsonArray(data: unknown, selector: string | undefined): unknown[] {
  if (!selector?.trim()) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      for (const key of ['results', 'items', 'torrents', 'data']) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[];
      }
    }
    return [];
  }
  const parts = selector.split('.').filter(Boolean);
  let cur: unknown = data;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return [];
    cur = (cur as Record<string, unknown>)[part];
  }
  return Array.isArray(cur) ? cur : [];
}

function parseJsonResults(
  body: string,
  plugin: AudiobookSearchPlugin,
): Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const items = getJsonArray(data, plugin.resultSelector);
  const rows: Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const title = extractWithPattern(item, plugin.titlePattern) ?? item.slice(0, 120);
      const magnet =
        extractWithPattern(item, plugin.magnetPattern) ??
        (item.startsWith('magnet:') ? item : undefined);
      const torrent = extractWithPattern(item, plugin.torrentUrlPattern);
      if (magnet || torrent) rows.push({ title, magnetUrl: magnet, torrentUrl: torrent });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const blob = JSON.stringify(obj);
    const title =
      (typeof obj.title === 'string' && obj.title) ||
      (typeof obj.name === 'string' && obj.name) ||
      extractWithPattern(blob, plugin.titlePattern) ||
      'Result';
    const magnet =
      (typeof obj.magnet === 'string' && obj.magnet) ||
      (typeof obj.magnetUrl === 'string' && obj.magnetUrl) ||
      extractWithPattern(blob, plugin.magnetPattern);
    const torrent =
      (typeof obj.torrent === 'string' && obj.torrent) ||
      (typeof obj.torrentUrl === 'string' && obj.torrentUrl) ||
      (typeof obj.link === 'string' && obj.link.endsWith('.torrent') ? obj.link : undefined) ||
      extractWithPattern(blob, plugin.torrentUrlPattern);
    if (magnet || torrent) rows.push({ title, magnetUrl: magnet, torrentUrl: torrent });
  }
  return rows;
}

function parseCustomResults(
  body: string,
  plugin: AudiobookSearchPlugin,
): Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> {
  const blockRe = safeRegex(plugin.resultSelector);
  if (!blockRe) return parseHtmlLinks(body);
  const rows: Array<{ title: string; magnetUrl?: string; torrentUrl?: string }> = [];
  const blocks = body.match(blockRe) ?? [];
  for (const block of blocks) {
    const title = extractWithPattern(block, plugin.titlePattern) ?? 'Result';
    const magnet =
      extractWithPattern(block, plugin.magnetPattern) ??
      block.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)?.[0];
    const torrent =
      extractWithPattern(block, plugin.torrentUrlPattern) ??
      block.match(/https?:\/\/[^\s"'<>]+\.torrent[^\s"'<>]*/i)?.[0];
    if (magnet || torrent) rows.push({ title, magnetUrl: magnet, torrentUrl: torrent });
  }
  return rows;
}

export function parseSearchPluginBody(
  body: string,
  plugin: AudiobookSearchPlugin,
): Array<{ title: string; magnetUrl?: string; torrentUrl?: string; sizeBytes?: number }> {
  const hint = plugin.parserHint ?? (plugin.resultSelector ? 'custom' : 'html-links');
  if (hint === 'json') return parseJsonResults(body, plugin);
  if (hint === 'custom') return parseCustomResults(body, plugin);
  return parseHtmlLinks(body);
}

export function hitsFromParsedRows(
  rows: Array<{ title: string; magnetUrl?: string; torrentUrl?: string; sizeBytes?: number }>,
  plugin: AudiobookSearchPlugin,
): AcquireSearchHit[] {
  const out: AcquireSearchHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const key = row.magnetUrl ?? row.torrentUrl ?? row.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${plugin.id}-${i}`,
      title: row.title,
      pluginId: plugin.id,
      pluginName: plugin.name,
      magnetUrl: row.magnetUrl,
      torrentUrl: row.torrentUrl,
      sizeBytes: row.sizeBytes,
    });
  }
  return out;
}
