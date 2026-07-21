import { spawn } from 'node:child_process';
import { searchProxyTier } from './search.js';
import { isAllowedProxyStreamUrl } from './urlValidation.js';

/** Cache yt-dlp/Piped resolved CDN URLs so ExoPlayer Range requests do not re-run extractors. */
const RESOLVED_STREAM_TTL_MS = 10 * 60_000;
const resolvedStreamCache = new Map<string, { url: string; expiresAt: number }>();

function cacheKeyForTarget(url: string): string {
  return url.trim();
}

function readCachedResolvedStream(targetUrl: string): string | null {
  const key = cacheKeyForTarget(targetUrl);
  const hit = resolvedStreamCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    resolvedStreamCache.delete(key);
    return null;
  }
  return hit.url;
}

function writeCachedResolvedStream(targetUrl: string, streamUrl: string): void {
  resolvedStreamCache.set(cacheKeyForTarget(targetUrl), {
    url: streamUrl,
    expiresAt: Date.now() + RESOLVED_STREAM_TTL_MS,
  });
}

async function resolveStreamUrlForTarget(targetUrl: string): Promise<string> {
  const url = targetUrl.trim();
  const cached = readCachedResolvedStream(url);
  if (cached) return cached;

  const isGoogleVideo = /googlevideo\.com/i.test(url);
  if (isGoogleVideo) {
    writeCachedResolvedStream(url, url);
    return url;
  }

  const isWatch =
    /youtube\.com\/watch|youtu\.be\//i.test(url) || /^[a-zA-Z0-9_-]{11}$/.test(url);

  const streamResult = await spawnYtdlp(
    ['-g', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', url],
    isWatch ? 22_000 : 10_000,
  );
  const ytdlpStream = streamResult.ok
    ? streamResult.stdout.trim().split('\n')[0]?.trim() ?? null
    : null;
  let resolvedStream =
    ytdlpStream && ytdlpStream.startsWith('http') ? ytdlpStream : null;

  if (!resolvedStream && isWatch) {
    resolvedStream = await pipedStreamUrl(url);
  }

  if (!resolvedStream && (url.includes('youtube.com') || url.includes('youtu.be'))) {
    resolvedStream = await pipedStreamUrl(url);
  }

  const streamUrl = resolvedStream ?? url;
  writeCachedResolvedStream(url, streamUrl);
  return streamUrl;
}

type YtdlpInvocation = { cmd: string; prefixArgs: string[] };

/** Prefer YTDLP_PATH; else yt-dlp on PATH; else python -m yt_dlp (common pip install). */
function ytdlpInvocations(): YtdlpInvocation[] {
  const custom = process.env.YTDLP_PATH?.trim();
  if (custom) {
    if (custom.includes(' ')) {
      const parts = custom.split(/\s+/);
      return [{ cmd: parts[0], prefixArgs: parts.slice(1) }];
    }
    return [{ cmd: custom, prefixArgs: [] }];
  }
  return [
    { cmd: 'yt-dlp', prefixArgs: [] },
    { cmd: 'python', prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
  ];
}

/** Quick yt-dlp presence check for /health and Settings status chips. */
export async function ytdlpAvailable(): Promise<boolean> {
  const result = await spawnYtdlp(['--version'], 4000);
  return result.ok;
}

async function spawnYtdlp(
  extraArgs: string[],
  timeoutMs: number,
): Promise<{ stdout: string; ok: boolean }> {
  for (const inv of ytdlpInvocations()) {
    const result = await new Promise<{ stdout: string; ok: boolean }>((resolve) => {
      const args = [...inv.prefixArgs, ...extraArgs];
      const proc = spawn(inv.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => {
        proc.kill();
        resolve({ stdout: '', ok: false });
      }, timeoutMs);
      proc.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve({ stdout: '', ok: false });
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout: out, ok: code === 0 });
      });
    });
    if (result.ok) return result;
  }
  return { stdout: '', ok: false };
}

export interface ProxyResolveRow {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  sourceId: string;
  artworkUrl?: string;
  releaseYear?: string;
  resolveHint?: string;
}

async function ytdlpFlatIds(query: string): Promise<string[]> {
  const args = [
    'ytsearch6:' + query,
    '--no-playlist',
    '--no-warnings',
    '--flat-playlist',
    '--print',
    '%(id)s',
  ];
  const { stdout, ok } = await spawnYtdlp(args, 8_000);
  if (!ok) return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
}

async function ytdlpMetaForId(id: string): Promise<ProxyResolveRow | null> {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--print',
    '%(duration)s\t%(id)s\t%(title)s',
    url,
  ];
  const { stdout, ok } = await spawnYtdlp(args, 10_000);
  if (!ok) return null;
  const line = stdout.split('\n').find((l) => l.trim().includes(id));
  return line ? parseYtdlpLine(line.trim()) : null;
}

async function ytdlpResolve(query: string): Promise<ProxyResolveRow[]> {
  const args = [
    'ytsearch5:' + query,
    '--no-playlist',
    '--no-warnings',
    '--print',
    '%(duration)s\t%(id)s\t%(title)s',
  ];
  const { stdout, ok } = await spawnYtdlp(args, 22_000);
  if (ok) {
    const out: ProxyResolveRow[] = [];
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const row = parseYtdlpLine(t);
      if (row) out.push(row);
    }
    if (out.length > 0) return rankProxyRows(out, query).slice(0, 5);
  }

  const ids = await ytdlpFlatIds(query);
  if (ids.length === 0) return [];
  const rows = await Promise.all(ids.map((id) => ytdlpMetaForId(id)));
  const out = rows.filter((r): r is ProxyResolveRow => r != null);
  return rankProxyRows(out, query).slice(0, 5);
}

function parseYtdlpLine(line: string, artistDefault = 'YouTube'): ProxyResolveRow | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const durationRaw = Number(parts[0]);
  const idOrUrl = parts[1]?.trim();
  const title = parts[2]?.trim();
  const artist = parts[3]?.trim() || artistDefault;
  if (!idOrUrl || !title) return null;
  const watchUrl = idOrUrl.startsWith('http')
    ? idOrUrl
    : `https://www.youtube.com/watch?v=${idOrUrl}`;
  const sourceId = idOrUrl.startsWith('http')
    ? idOrUrl.replace(/[^a-zA-Z0-9]+/g, '').slice(-16)
    : idOrUrl;
  return {
    id: `proxy-ytdlp-${sourceId}`,
    title: title.slice(0, 160),
    artist: artist.slice(0, 80),
    url: `/api/proxy/stream?url=${encodeURIComponent(watchUrl)}`,
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
    sourceId,
    resolveHint: `ytdlp:${sourceId}`,
  };
}

/** Generic yt-dlp extractor prefix (e.g. scsearch5:query) — exported for addon resolve. */
export async function ytdlpExtractorSearch(
  searchExpr: string,
  artistDefault: string,
): Promise<ProxyResolveRow[]> {
  const args = [
    searchExpr,
    '--no-playlist',
    '--no-warnings',
    '--print',
    '%(duration)s\t%(webpage_url)s\t%(title)s\t%(uploader)s',
  ];
  const { stdout, ok } = await spawnYtdlp(args, 22_000);
  if (!ok) return [];
  const out: ProxyResolveRow[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const row = parseYtdlpLine(t, artistDefault);
    if (row) out.push(row);
  }
  return out.slice(0, 5);
}

const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://vid.puffyan.us',
  'https://inv.nadeko.net',
];

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api-piped.mha.fi',
];

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const watch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch?.[1]) return watch[1];
  const short = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short?.[1]) return short[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

const NON_MUSIC_TITLE_PATTERNS = [
  /\bdeep\s+diving\b/i,
  /\bcalls?\s+out\b/i,
  /\breaction\b/i,
  /\bexplained\b/i,
  /\breview\b/i,
  /\bpodcast\b/i,
  /\binterview\b/i,
  /\bcommentary\b/i,
];

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function queryRelevance(title: string, artist: string, query: string): number {
  const hay = `${title} ${artist}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  let score = hits / tokens.length;
  if (NON_MUSIC_TITLE_PATTERNS.some((re) => re.test(title))) score *= 0.25;
  const nTitle = normalizeMatchText(title);
  const nQuery = normalizeMatchText(query);
  if (nQuery && nTitle.includes(nQuery.replace(/\s+/g, ' '))) score = Math.max(score, 0.9);
  const albumToken = query.match(/\b\d{1,2}:\d{2}\b/)?.[0];
  if (albumToken && hay.includes(albumToken)) score = Math.max(score, 0.82);
  return Math.min(score, 1);
}

function proxyRowScore(row: ProxyResolveRow, query: string): number {
  let rel = queryRelevance(row.title, row.artist, query);
  const dur = row.durationSeconds ?? 0;
  if (dur > 0 && dur < 90) rel *= 0.35;
  else if (dur >= 150 && dur <= 480) rel = Math.min(1, rel + 0.12);
  return rel;
}

function rankProxyRows(rows: ProxyResolveRow[], query: string): ProxyResolveRow[] {
  return [...rows].sort(
    (a, b) => proxyRowScore(b, query) - proxyRowScore(a, query),
  );
}

async function invidiousResolve(query: string): Promise<ProxyResolveRow[]> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
        {
          headers: { 'User-Agent': 'SandboxTier34/1.0' },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Array<{
        videoId?: string;
        title?: string;
        author?: string;
        lengthSeconds?: number;
      }>;
      const out: ProxyResolveRow[] = [];
      for (const row of data ?? []) {
        if (!row.videoId) continue;
        const title = (row.title ?? query).slice(0, 160);
        const artist = row.author ?? 'YouTube';
        if (queryRelevance(title, artist, query) < 0.45) continue;
        const watchUrl = `https://www.youtube.com/watch?v=${row.videoId}`;
        out.push({
          id: `proxy-invidious-${row.videoId}`,
          title,
          artist,
          url: `/api/proxy/stream?url=${encodeURIComponent(watchUrl)}`,
          durationSeconds:
            typeof row.lengthSeconds === 'number' && row.lengthSeconds > 0
              ? row.lengthSeconds
              : 0,
          sourceId: row.videoId,
          resolveHint: `invidious:${row.videoId}`,
        });
        if (out.length >= 8) break;
      }
      if (out.length > 0) return rankProxyRows(out, query).slice(0, 5);
    } catch {
      continue;
    }
  }
  return [];
}

async function pipedResolve(query: string): Promise<ProxyResolveRow[]> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(
        `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`,
        {
          headers: { 'User-Agent': 'SandboxTier34/1.0' },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        items?: Array<{
          url?: string;
          title?: string;
          uploaderName?: string;
          uploader?: string;
          duration?: number;
          thumbnail?: string;
        }>;
      };
      const out: ProxyResolveRow[] = [];
      for (const row of data.items ?? []) {
        const rawUrl = row.url?.trim() ?? '';
        const videoId =
          extractYoutubeVideoId(rawUrl) ??
          (rawUrl.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/)?.[1] ?? null);
        if (!videoId) continue;
        const title = (row.title ?? query).slice(0, 160);
        const artist = row.uploaderName ?? row.uploader ?? 'YouTube';
        if (queryRelevance(title, artist, query) < 0.45) continue;
        const watchUrl = youtubeWatchUrl(videoId);
        out.push({
          id: `proxy-piped-${videoId}`,
          title,
          artist,
          url: `/api/proxy/stream?url=${encodeURIComponent(watchUrl)}`,
          durationSeconds:
            typeof row.duration === 'number' && row.duration > 0 ? row.duration : 0,
          sourceId: videoId,
          artworkUrl: row.thumbnail,
          resolveHint: `piped:${videoId}`,
        });
        if (out.length >= 8) break;
      }
      if (out.length > 0) return rankProxyRows(out, query).slice(0, 5);
    } catch {
      continue;
    }
  }
  return [];
}

/** Resolve direct audio URL via Piped streams API (yt-dlp fallback). */
async function pipedStreamUrl(watchUrl: string): Promise<string | null> {
  const videoId = extractYoutubeVideoId(watchUrl);
  if (!videoId) return null;
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { 'User-Agent': 'SandboxTier34/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        audioStreams?: Array<{ url?: string; bitrate?: number }>;
      };
      const streams = (data.audioStreams ?? []).filter((s) => s.url?.startsWith('http'));
      streams.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const best = streams[0]?.url?.trim();
      if (best) return best;
    } catch {
      continue;
    }
  }
  return null;
}

/** yt-dlp when available; Invidious → Piped → archive/catalog last. */
export async function resolveProxyCandidates(query: string): Promise<ProxyResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  const ytdlp = await ytdlpResolve(q);
  if (ytdlp.length > 0) return ytdlp;

  const invidious = await invidiousResolve(q);
  if (invidious.length > 0) return invidious;

  const piped = await pipedResolve(q);
  if (piped.length > 0) return piped;

  const fallback = await searchProxyTier(q);
  return fallback
    .filter((row) => queryRelevance(row.title, row.artist, q) >= 0.45)
    .filter((row) => !row.url.includes('audio-ssl'))
    .map((row) => ({
      id: row.envelopeId,
      title: row.title,
      artist: row.artist,
      url:
        row.transport === 'stream-proxy'
          ? `/api/proxy/stream?url=${encodeURIComponent(row.url)}`
          : row.url,
      durationSeconds: row.durationSeconds,
      sourceId: row.sourceId,
      artworkUrl: row.artworkUrl,
      releaseYear: row.releaseYear,
      resolveHint: row.resolveHint,
    }));
}

export async function proxyStreamUpstream(
  targetUrl: string,
  clientHeaders?: Record<string, string>,
): Promise<Response> {
  const url = targetUrl.trim();
  if (!url.startsWith('http')) {
    return new Response(null, { status: 400 });
  }
  if (!isAllowedProxyStreamUrl(url)) {
    return new Response(null, { status: 403 });
  }

  const streamUrl = await resolveStreamUrlForTarget(url);
  const headers = streamFetchHeaders(streamUrl);
  if (clientHeaders?.Range) {
    headers.Range = clientHeaders.Range;
  }
  if (clientHeaders?.['If-Range']) {
    headers['If-Range'] = clientHeaders['If-Range'];
  }
  return fetch(streamUrl, { headers });
}

function streamFetchHeaders(streamUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    Accept: 'audio/*,*/*;q=0.9',
  };
  if (/googlevideo\.com|youtube\.com|youtu\.be/i.test(streamUrl)) {
    headers.Referer = 'https://www.youtube.com/';
    headers.Origin = 'https://www.youtube.com';
  }
  return headers;
}
