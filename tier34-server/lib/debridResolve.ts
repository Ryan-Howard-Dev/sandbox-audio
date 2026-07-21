import {
  isTorrentResolvableInput,
  normalizeTorrentInput,
  searchTorrentHits,
} from './sandboxIndexer.js';
import { searchDebridTier } from './search.js';

export interface DebridResolveRow {
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

export interface DebridResolveOptions {
  query: string;
  prowlarrUrl?: string;
  prowlarrApiKey?: string;
  realDebridApiKey?: string;
}

export async function realDebridUnrestrict(
  apiKey: string,
  magnetOrLink: string,
): Promise<string | null> {
  const isMagnet = magnetOrLink.startsWith('magnet:');
  if (isMagnet) {
    const addRes = await fetch('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ magnet: magnetOrLink }),
    });
    if (!addRes.ok) return null;
    const added = (await addRes.json()) as { id?: string };
    if (!added.id) return null;

    await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${added.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ files: 'all' }),
    });

    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const infoRes = await fetch(
        `https://api.real-debrid.com/rest/1.0/torrents/info/${added.id}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!infoRes.ok) continue;
      const info = (await infoRes.json()) as {
        status?: string;
        files?: Array<{ path?: string; links?: string[] }>;
      };
      if (info.status === 'downloaded' || info.status === 'dead') {
        const audio = (info.files ?? []).find((f) =>
          /\.(flac|mp3|m4a|wav|ogg)$/i.test(f.path ?? ''),
        );
        const link = audio?.links?.[0];
        if (link) {
          const unrestrict = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ link }),
          });
          if (unrestrict.ok) {
            const body = (await unrestrict.json()) as { download?: string };
            return body.download ?? null;
          }
        }
        break;
      }
    }
    return null;
  }

  const unrestrict = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ link: magnetOrLink }),
  });
  if (!unrestrict.ok) return null;
  const body = (await unrestrict.json()) as { download?: string };
  return body.download ?? null;
}

function parseTitleArtist(raw: string, query: string): { title: string; artist: string } {
  const cleaned = raw.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { title: cleaned || query, artist: 'Debrid' };
}

/** Sandbox Indexer (Torznab/Prowlarr) → Real-Debrid when RD key present; archive FLAC fallback otherwise. */
export async function resolveDebridCandidates(
  options: DebridResolveOptions,
): Promise<DebridResolveRow[]> {
  const q = options.query.trim();
  if (!q) return [];

  const prowlarrUrl =
    options.prowlarrUrl?.trim() || process.env.PROWLARR_URL?.trim() || '';
  const prowlarrKey =
    options.prowlarrApiKey?.trim() || process.env.PROWLARR_API_KEY?.trim() || '';
  const rdKey =
    options.realDebridApiKey?.trim() || process.env.REALDEBRID_API_KEY?.trim() || '';

  if (rdKey) {
    try {
      const directLink = normalizeTorrentInput(q);
      const hits = isTorrentResolvableInput(q) && directLink
        ? [
            {
              id: 'magnet-direct',
              title: directLink.slice(0, 80),
              artist: 'Direct',
              url: directLink,
              magnetUrl: directLink.startsWith('magnet:') ? directLink : undefined,
              downloadUrl: directLink.startsWith('http') ? directLink : undefined,
              durationSeconds: 0,
              sourceId: 'direct',
              source: 'magnet' as const,
              resolveHint: 'magnet:direct',
            },
          ]
        : await searchTorrentHits({
            query: q,
            prowlarrUrl,
            prowlarrApiKey: prowlarrKey,
          });

      const out: DebridResolveRow[] = [];
      for (const hit of hits.slice(0, 3)) {
        const magnet = hit.magnetUrl ?? hit.downloadUrl ?? hit.url;
        if (!magnet) continue;
        const direct = await realDebridUnrestrict(rdKey, magnet);
        if (!direct) continue;
        const { title, artist } = parseTitleArtist(hit.title ?? q, q);
        out.push({
          id: `debrid-rd-${out.length}`,
          title,
          artist,
          url: direct,
          durationSeconds: 0,
          sourceId: hit.sourceId ?? `rd-${out.length}`,
          resolveHint: hit.resolveHint ?? `indexer:${hit.source ?? 'torrent'}`,
        });
      }
      if (out.length > 0) return out;
    } catch (e) {
      console.warn('[tier34] debrid pipeline', e);
    }
  }

  const fallback = await searchDebridTier(q);
  return fallback.map((row) => ({
    id: row.envelopeId,
    title: row.title,
    artist: row.artist,
    url: row.url,
    durationSeconds: row.durationSeconds,
    sourceId: row.sourceId,
    artworkUrl: row.artworkUrl,
    releaseYear: row.releaseYear,
    resolveHint: row.resolveHint ?? 'archive-flac-fallback',
  }));
}

export async function testProwlarrConnection(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!apiKey.trim()) return { ok: false, detail: 'API key required' };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/system/status`, {
      headers: { 'X-Api-Key': apiKey.trim() },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: 'Prowlarr online' };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export async function testRealDebridConnection(
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!apiKey.trim()) return { ok: false, detail: 'API key required' };
  try {
    const res = await fetch('https://api.real-debrid.com/rest/1.0/user', {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const user = (await res.json()) as { username?: string };
    return { ok: true, detail: user.username ? `RD user: ${user.username}` : 'Real-Debrid OK' };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
