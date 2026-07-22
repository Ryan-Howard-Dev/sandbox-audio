/**
 * Audiobook magnet/torrent acquire — on-device plugin search; resolve/download via Real-Debrid + Tier34.
 */

import { isAirGapEnabled } from './airGapMode';
import { loadPlaybackEngineSettings } from './playbackEngineSettings';
import { getTier34BaseUrl } from './tier34/client';
import type { AudiobookSearchPlugin } from './audiobookSearchPlugins';
import {
  applySearchUrlTemplate,
  hitsFromParsedRows,
  isAllowedSearchPluginUrl,
  parseSearchPluginBody,
  type AcquireSearchHit,
  type AudiobookAcquireResolver,
  type ResolvedAcquire,
} from '../tier34-server/lib/audiobookAcquireCore';

export type {
  AcquireSearchHit,
  ResolvedAcquire,
  ResolvedAcquireFile,
  AudiobookAcquireResolver,
} from '../tier34-server/lib/audiobookAcquireCore';

export const AUDIOBOOK_RD_REQUIRED_MESSAGE =
  'Configure Real-Debrid in Settings → Add-ons for torrent downloads (optional). Search still works without it.';

export const AUDIOBOOK_TIER34_DOWNLOAD_MESSAGE =
  'Torrent downloads need Sandbox Server when Real-Debrid is configured. Search still works on this device.';

async function postTier34<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  if (isAirGapEnabled()) return null;
  const base = getTier34BaseUrl().trim().replace(/\/$/, '');
  if (!base) return null;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function engineSecrets(): { realDebridApiKey: string } {
  const engine = loadPlaybackEngineSettings();
  return { realDebridApiKey: engine.realDebridApiKey?.trim() ?? '' };
}

function requireRealDebridKey(): string {
  const key = engineSecrets().realDebridApiKey;
  if (!key) throw new Error(AUDIOBOOK_RD_REQUIRED_MESSAGE);
  return key;
}

/** On-device plugin search — no Sandbox Server required. */
export async function searchAudiobookPluginsClient(
  query: string,
  plugins: AudiobookSearchPlugin[],
): Promise<AcquireSearchHit[]> {
  const q = query.trim();
  const enabled = plugins.filter((p) => p.enabled);
  if (!q || enabled.length === 0 || isAirGapEnabled()) return [];

  const batches = await Promise.all(
    enabled.map(async (plugin) => {
      try {
        const url = applySearchUrlTemplate(plugin.searchUrlTemplate, q);
        if (!isAllowedSearchPluginUrl(url)) return [] as AcquireSearchHit[];
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'SandboxMusic/1.0',
            Accept: 'text/html,application/json,*/*',
          },
          signal: AbortSignal.timeout(14_000),
        });
        if (!res.ok) return [];
        const body = await res.text();
        return hitsFromParsedRows(parseSearchPluginBody(body, plugin), plugin);
      } catch {
        return [];
      }
    }),
  );
  return batches.flat();
}

function dedupeAcquireHits(hits: AcquireSearchHit[]): AcquireSearchHit[] {
  const seen = new Set<string>();
  const out: AcquireSearchHit[] = [];
  for (const hit of hits) {
    const key = hit.magnetUrl ?? hit.torrentUrl ?? `${hit.pluginId}:${hit.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export const audiobookAcquireResolver: AudiobookAcquireResolver = {
  async resolveMagnet(magnet: string): Promise<ResolvedAcquire> {
    const realDebridApiKey = requireRealDebridKey();
    const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/resolve', {
      magnet,
      realDebridApiKey,
    });
    if (!data?.resolved) throw new Error(AUDIOBOOK_TIER34_DOWNLOAD_MESSAGE);
    return data.resolved;
  },

  async resolveTorrent(torrentUrl: string): Promise<ResolvedAcquire> {
    const realDebridApiKey = requireRealDebridKey();
    const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/resolve', {
      torrentUrl,
      realDebridApiKey,
    });
    if (!data?.resolved) throw new Error(AUDIOBOOK_TIER34_DOWNLOAD_MESSAGE);
    return data.resolved;
  },

  async searchPlugins(query: string, plugins: AudiobookSearchPlugin[]): Promise<AcquireSearchHit[]> {
    const enabled = plugins.filter((p) => p.enabled);
    const [local, remote] = await Promise.all([
      searchAudiobookPluginsClient(query, enabled),
      postTier34<{ hits?: AcquireSearchHit[] }>('/api/audiobook/acquire/search', {
        query,
        plugins: enabled,
      })
        .then((data) => data?.hits ?? [])
        .catch(() => [] as AcquireSearchHit[]),
    ]);
    // Client path is primary; Tier34 is an optional boost when available.
    return dedupeAcquireHits([...local, ...remote]);
  },
};

export async function downloadAudiobookAcquire(
  resolved: ResolvedAcquire,
  options?: { title?: string },
): Promise<ResolvedAcquire> {
  const realDebridApiKey = requireRealDebridKey();
  const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/download', {
    resolved: { ...resolved, title: options?.title ?? resolved.title },
    realDebridApiKey,
  });
  if (!data?.resolved) throw new Error(AUDIOBOOK_TIER34_DOWNLOAD_MESSAGE);
  return data.resolved;
}
