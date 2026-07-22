/**
 * Audiobook magnet/torrent acquire — search plugins, resolve, download to ingest folder.
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { realDebridUnrestrict } from './debridResolve.js';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import {
  applySearchUrlTemplate,
  extractInfoHash,
  hitsFromParsedRows,
  isAllowedSearchPluginUrl,
  normalizeMagnetOrTorrentInput,
  parseSearchPluginBody,
  type AcquireSearchHit,
  type AudiobookSearchPlugin,
  type ResolvedAcquire,
  type ResolvedAcquireFile,
} from './audiobookAcquireCore.js';

const AUDIO_EXT_RE = /\.(m4b|mp3|m4a|flac|ogg|opus|aac|wav)$/i;
const INGEST_DIR = join(LOCKER_STORAGE_ROOT, 'audiobook-ingest');

export async function searchAudiobookPlugins(
  query: string,
  plugins: AudiobookSearchPlugin[],
): Promise<AcquireSearchHit[]> {
  const q = query.trim();
  if (!q || plugins.length === 0) return [];

  const enabled = plugins.filter((p) => p.enabled);
  const results = await Promise.all(
    enabled.map(async (plugin) => {
      try {
        const url = applySearchUrlTemplate(plugin.searchUrlTemplate, q);
        if (!isAllowedSearchPluginUrl(url)) return [] as AcquireSearchHit[];
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'SandboxTier34/1.0',
            Accept: 'text/html,application/json,*/*',
          },
          signal: AbortSignal.timeout(14_000),
        });
        if (!res.ok) return [];
        const body = await res.text();
        const rows = parseSearchPluginBody(body, plugin);
        return hitsFromParsedRows(rows, plugin);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

async function listRdTorrentFiles(
  apiKey: string,
  magnetOrLink: string,
): Promise<ResolvedAcquireFile[]> {
  const isMagnet = magnetOrLink.startsWith('magnet:');
  if (!isMagnet) {
    const direct = await realDebridUnrestrict(apiKey, magnetOrLink);
    if (!direct) return [];
    const name = direct.split('/').pop()?.split('?')[0] ?? 'audio';
    return [{ path: name, url: direct }];
  }

  const addRes = await fetch('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ magnet: magnetOrLink }),
  });
  if (!addRes.ok) return [];
  const added = (await addRes.json()) as { id?: string };
  if (!added.id) return [];

  await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${added.id}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ files: 'all' }),
  });

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const infoRes = await fetch(
      `https://api.real-debrid.com/rest/1.0/torrents/info/${added.id}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!infoRes.ok) continue;
    const info = (await infoRes.json()) as {
      status?: string;
      files?: Array<{ path?: string; bytes?: number; links?: string[] }>;
    };
    if (info.status === 'downloaded' || info.status === 'dead') {
      const files: ResolvedAcquireFile[] = [];
      for (const f of info.files ?? []) {
        const path = f.path ?? 'file';
        if (!AUDIO_EXT_RE.test(path)) continue;
        const link = f.links?.[0];
        if (!link) continue;
        const unrestrict = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ link }),
        });
        if (!unrestrict.ok) continue;
        const body = (await unrestrict.json()) as { download?: string; filename?: string };
        if (!body.download) continue;
        files.push({
          path,
          url: body.download,
          size: f.bytes,
        });
      }
      return files;
    }
  }
  return [];
}

export async function resolveAudiobookAcquire(input: {
  magnet?: string;
  torrentUrl?: string;
  title?: string;
  realDebridApiKey?: string;
}): Promise<ResolvedAcquire> {
  const link =
    normalizeMagnetOrTorrentInput(input.magnet ?? '') ??
    normalizeMagnetOrTorrentInput(input.torrentUrl ?? '') ??
    input.magnet?.trim() ??
    input.torrentUrl?.trim() ??
    '';
  if (!link) {
    throw new Error('Magnet or torrent URL required');
  }

  const title = input.title?.trim() || 'Audiobook';
  const infoHash = extractInfoHash(link) ?? undefined;
  const rdKey = input.realDebridApiKey?.trim() ?? process.env.REALDEBRID_API_KEY?.trim() ?? '';

  if (!rdKey) {
    throw new Error(
      'Configure Real-Debrid in Settings → Add-ons for torrent downloads (optional). Search still works without it.',
    );
  }

  const files = await listRdTorrentFiles(rdKey, link);
  if (files.length === 0) {
    throw new Error('Real-Debrid did not return playable audio files for this torrent');
  }
  return { title, infoHash, files };
}

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180);
}

export async function downloadResolvedAudiobook(
  resolved: ResolvedAcquire,
  realDebridApiKey?: string,
): Promise<ResolvedAcquire> {
  const rdKey = realDebridApiKey?.trim() ?? process.env.REALDEBRID_API_KEY?.trim() ?? '';
  if (!rdKey) {
    throw new Error(
      'Configure Real-Debrid in Settings → Add-ons for torrent downloads (optional). Search still works without it.',
    );
  }
  const albumDir = join(INGEST_DIR, safeFilename(resolved.title));
  mkdirSync(albumDir, { recursive: true });

  const saved: ResolvedAcquireFile[] = [];
  for (const file of resolved.files) {
    let downloadUrl = file.url;
    if (downloadUrl.startsWith('magnet:') || /\.torrent(\?|$)/i.test(downloadUrl)) {
      const unrestrict = await realDebridUnrestrict(rdKey, downloadUrl);
      if (!unrestrict) continue;
      downloadUrl = unrestrict;
    }
    if (!downloadUrl.startsWith('http')) continue;

    const baseName = safeFilename(file.path.split('/').pop() ?? file.path);
    const dest = join(albumDir, baseName);
    if (existsSync(dest)) {
      saved.push({ ...file, path: dest, url: downloadUrl });
      continue;
    }

    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'SandboxTier34/1.0' },
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok || !res.body) continue;
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
    saved.push({ ...file, path: dest, url: downloadUrl });
  }

  return {
    ...resolved,
    files: saved,
    importPath: albumDir,
  };
}
