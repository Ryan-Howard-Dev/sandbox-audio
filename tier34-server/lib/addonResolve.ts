/**
 * Built-in addon resolve — SoundCloud, WebTorrent (magnet/P2P), IPFS/mesh.
 * Full streams only — never returns 30s catalog preview URLs (audio-ssl).
 */

import { resolveDebridCandidates } from './debridResolve.js';
import { searchArchiveTier } from './search.js';
import { ytdlpExtractorSearch } from './proxyResolve.js';

export interface AddonResolveRow {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  sourceId: string;
  provider: 'stream-proxy' | 'webtorrent' | 'ipfs' | 'dht-swarm' | 'radio-browser' | 'audius' | 'soulseek';
  transport: 'element-src' | 'stream-proxy' | 'p2p';
  artworkUrl?: string;
  releaseYear?: string;
  resolveHint?: string;
}

const RADIO_BROWSER_API = 'https://de1.api.radio-browser.info/json/stations/search';

type RadioStation = {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  bitrate?: number;
  codec?: string;
};

type AudiusTrack = {
  id?: string;
  title?: string;
  user?: { name?: string; handle?: string };
  duration?: number;
  artwork?: { '150x150'?: string; '480x480'?: string; '1000x1000'?: string };
  release_date?: string;
};

function isPreviewUrl(url: string): boolean {
  return url.includes('audio-ssl');
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

function rankRows(rows: AddonResolveRow[], query: string): AddonResolveRow[] {
  return [...rows]
    .filter((r) => r.url && !isPreviewUrl(r.url))
    .filter((r) => queryRelevance(r.title, r.artist, query) >= 0.35)
    .sort(
      (a, b) =>
        queryRelevance(b.title, b.artist, query) -
        queryRelevance(a.title, a.artist, query),
    )
    .slice(0, 5);
}

type ScTrack = {
  id?: number;
  title?: string;
  user?: { username?: string };
  duration?: number;
  artwork_url?: string;
  media?: { transcodings?: Array<{ url?: string; format?: { mime_type?: string } }> };
};

async function soundCloudApiSearch(
  query: string,
  clientId: string,
): Promise<AddonResolveRow[]> {
  const res = await fetch(
    `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=8`,
    { headers: { 'User-Agent': 'SandboxTier34/1.0' }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { collection?: ScTrack[] };
  const out: AddonResolveRow[] = [];

  for (const track of data.collection ?? []) {
    if (!track.id || !track.title) continue;
    const transcoding = track.media?.transcodings?.find(
      (t) => t.format?.mime_type?.includes('audio/mpeg') || t.url,
    );
    if (!transcoding?.url) continue;
    const streamRes = await fetch(
      `${transcoding.url}?client_id=${encodeURIComponent(clientId)}`,
      { headers: { 'User-Agent': 'SandboxTier34/1.0' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!streamRes.ok) continue;
    const streamData = (await streamRes.json()) as { url?: string };
    const streamUrl = streamData.url?.trim();
    if (!streamUrl || isPreviewUrl(streamUrl)) continue;

    out.push({
      id: `sc-${track.id}`,
      title: track.title.slice(0, 160),
      artist: track.user?.username ?? 'SoundCloud',
      url: streamUrl,
      durationSeconds: Math.round((track.duration ?? 0) / 1000),
      sourceId: String(track.id),
      provider: 'stream-proxy',
      transport: 'element-src',
      artworkUrl: track.artwork_url?.replace('-large', '-t500x500'),
      resolveHint: `soundcloud:${track.id}`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** SoundCloud — API when client_id set; yt-dlp scsearch fallback (full streams via proxy). */
export async function resolveSoundCloudAddon(
  query: string,
  clientId?: string,
): Promise<AddonResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  if (clientId?.trim()) {
    const api = await soundCloudApiSearch(q, clientId.trim());
    if (api.length > 0) return rankRows(api, q);
  }

  const ytdlp = await ytdlpExtractorSearch(`scsearch5:${q}`, 'SoundCloud');
  return rankRows(
    ytdlp.map((row) => ({
      id: row.id.replace(/^proxy-/, 'sc-'),
      title: row.title,
      artist: row.artist === 'YouTube' ? 'SoundCloud' : row.artist,
      url: row.url,
      durationSeconds: row.durationSeconds,
      sourceId: row.sourceId,
      provider: 'stream-proxy' as const,
      transport: 'stream-proxy' as const,
      artworkUrl: row.artworkUrl,
      releaseYear: row.releaseYear,
      resolveHint: row.resolveHint ?? `soundcloud:ytdlp:${row.sourceId}`,
    })),
    q,
  );
}

/** WebTorrent — Real-Debrid magnet unrestrict when configured; archive full files as P2P fallback. */
export async function resolveWebTorrentAddon(
  query: string,
  opts?: { prowlarrUrl?: string; prowlarrApiKey?: string; realDebridApiKey?: string },
): Promise<AddonResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  const rdKey = opts?.realDebridApiKey?.trim() || process.env.REALDEBRID_API_KEY?.trim();
  if (rdKey) {
    const debrid = await resolveDebridCandidates({
      query: q,
      prowlarrUrl: opts?.prowlarrUrl ?? process.env.PROWLARR_URL ?? '',
      prowlarrApiKey: opts?.prowlarrApiKey ?? process.env.PROWLARR_API_KEY ?? '',
      realDebridApiKey: rdKey,
    });
    const magnetRows = debrid
      .filter((r) => r.url && !isPreviewUrl(r.url))
      .map((r) => ({
        id: r.id.replace(/^debrid-/, 'wt-'),
        title: r.title,
        artist: r.artist,
        url: r.url,
        durationSeconds: r.durationSeconds,
        sourceId: r.sourceId,
        provider: 'webtorrent' as const,
        transport: 'p2p' as const,
        artworkUrl: r.artworkUrl,
        releaseYear: r.releaseYear,
        resolveHint: r.resolveHint ?? `magnet:${r.sourceId}`,
      }));
    if (magnetRows.length > 0) return rankRows(magnetRows, q);
  }

  const arch = await searchArchiveTier(q, false);
  return rankRows(
    arch
      .filter((e) => e.url && !isPreviewUrl(e.url))
      .map((e) => ({
        id: e.envelopeId.replace('tier34-arch', 'wt-arch'),
        title: e.title,
        artist: e.artist,
        url: e.url,
        durationSeconds: e.durationSeconds,
        sourceId: e.sourceId,
        provider: 'webtorrent' as const,
        transport: 'p2p' as const,
        artworkUrl: e.artworkUrl,
        releaseYear: e.releaseYear,
        resolveHint: e.resolveHint ?? `arch-p2p:${e.sourceId}`,
      })),
    q,
  );
}

/**
 * Radio Browser — live station search. Playback uses direct stream URLs (proxied via tier34).
 * Download/acquire is not supported for live radio — play-only.
 */
export async function resolveRadioBrowserAddon(query: string): Promise<AddonResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const res = await fetch(
      `${RADIO_BROWSER_API}?name=${encodeURIComponent(q)}&limit=12&order=clickcount&reverse=true`,
      {
        headers: {
          'User-Agent': 'SandboxTier34/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const stations = (await res.json()) as RadioStation[];
    const out: AddonResolveRow[] = [];

    for (const station of stations ?? []) {
      const streamUrl = (station.url_resolved ?? station.url ?? '').trim();
      const name = (station.name ?? q).slice(0, 160);
      if (!streamUrl || !name) continue;
      if (!streamUrl.startsWith('http')) continue;
      const uuid = station.stationuuid ?? streamUrl;
      const tags = station.tags?.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3);
      const artist = [station.country, ...(tags ?? [])].filter(Boolean).join(' · ') || 'Radio';
      out.push({
        id: `radio-${uuid}`,
        title: name,
        artist: artist.slice(0, 80),
        url: `/api/addon/radio-browser/stream?url=${encodeURIComponent(streamUrl)}`,
        durationSeconds: 0,
        sourceId: uuid,
        provider: 'radio-browser',
        transport: 'element-src',
        artworkUrl: station.favicon?.startsWith('http') ? station.favicon : undefined,
        resolveHint: `radio-browser:${uuid}`,
      });
      if (out.length >= 8) break;
    }
    return rankRows(out, q);
  } catch {
    return [];
  }
}

/** Audius — decentralized catalog; full CDN stream URLs. */
export async function resolveAudiusAddon(
  query: string,
  opts?: { apiKey?: string; appName?: string },
): Promise<AddonResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  const appName = opts?.appName?.trim() || process.env.AUDIUS_APP_NAME?.trim() || 'SandboxMusic';
  const apiKey = opts?.apiKey?.trim() || process.env.AUDIUS_API_KEY?.trim() || '';
  const params = new URLSearchParams({ query: q, app_name: appName });
  if (apiKey) params.set('api_key', apiKey);

  try {
    const res = await fetch(`https://api.audius.co/v1/tracks/search?${params}`, {
      headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: AudiusTrack[] };
    const out: AddonResolveRow[] = [];

    for (const track of data.data ?? []) {
      if (!track.id || !track.title) continue;
      const streamParams = new URLSearchParams({ app_name: appName });
      if (apiKey) streamParams.set('api_key', apiKey);
      const streamUrl = `https://api.audius.co/v1/tracks/${track.id}/stream?${streamParams}`;
      const artist = track.user?.name ?? track.user?.handle ?? 'Audius';
      const artwork =
        track.artwork?.['480x480'] ??
        track.artwork?.['1000x1000'] ??
        track.artwork?.['150x150'];
      out.push({
        id: `audius-${track.id}`,
        title: track.title.slice(0, 160),
        artist: artist.slice(0, 80),
        url: streamUrl,
        durationSeconds:
          typeof track.duration === 'number' && track.duration > 0 ? track.duration : 0,
        sourceId: track.id,
        provider: 'audius',
        transport: 'element-src',
        artworkUrl: artwork,
        releaseYear: track.release_date?.slice(0, 4),
        resolveHint: `audius:${track.id}`,
      });
      if (out.length >= 8) break;
    }
    return rankRows(out, q);
  } catch {
    return [];
  }
}

/** IPFS / mesh — archive.org direct downloads (content-addressable); proxied when needed. */
export async function resolveIpfsAddon(query: string): Promise<AddonResolveRow[]> {
  const q = query.trim();
  if (!q) return [];

  const arch = await searchArchiveTier(q, true);
  const flac = arch.filter((e) => e.url && !isPreviewUrl(e.url));
  const pool = flac.length > 0 ? flac : await searchArchiveTier(q, false);

  return rankRows(
    pool
      .filter((e) => e.url && !isPreviewUrl(e.url))
      .map((e) => ({
        id: e.envelopeId.replace('tier34-arch', 'ipfs'),
        title: e.title,
        artist: e.artist,
        url: e.url,
        durationSeconds: e.durationSeconds,
        sourceId: e.sourceId,
        provider: 'ipfs' as const,
        transport: 'p2p' as const,
        artworkUrl: e.artworkUrl,
        releaseYear: e.releaseYear,
        resolveHint: `ipfs:arch:${e.sourceId}`,
      })),
    q,
  );
}
