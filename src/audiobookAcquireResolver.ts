/**
 * Audiobook magnet/torrent acquire — client resolver via Tier34.
 */

import { isAirGapEnabled } from './airGapMode';
import { loadPlaybackEngineSettings } from './playbackEngineSettings';
import { getTier34BaseUrl } from './tier34/client';
import type { AudiobookSearchPlugin } from './audiobookSearchPlugins';
import type {
  AcquireSearchHit,
  AudiobookAcquireResolver,
  ResolvedAcquire,
} from '../tier34-server/lib/audiobookAcquireCore';

export type {
  AcquireSearchHit,
  ResolvedAcquire,
  ResolvedAcquireFile,
  AudiobookAcquireResolver,
} from '../tier34-server/lib/audiobookAcquireCore';

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

export const audiobookAcquireResolver: AudiobookAcquireResolver = {
  async resolveMagnet(magnet: string): Promise<ResolvedAcquire> {
    const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/resolve', {
      magnet,
      ...engineSecrets(),
    });
    if (!data?.resolved) throw new Error('Resolve failed — configure Sandbox Server and Real-Debrid for torrents');
    return data.resolved;
  },

  async resolveTorrent(torrentUrl: string): Promise<ResolvedAcquire> {
    const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/resolve', {
      torrentUrl,
      ...engineSecrets(),
    });
    if (!data?.resolved) throw new Error('Resolve failed — configure Sandbox Server and Real-Debrid for torrents');
    return data.resolved;
  },

  async searchPlugins(query: string, plugins: AudiobookSearchPlugin[]): Promise<AcquireSearchHit[]> {
    const data = await postTier34<{ hits?: AcquireSearchHit[] }>('/api/audiobook/acquire/search', {
      query,
      plugins: plugins.filter((p) => p.enabled),
    });
    return data?.hits ?? [];
  },
};

export async function downloadAudiobookAcquire(
  resolved: ResolvedAcquire,
  options?: { title?: string },
): Promise<ResolvedAcquire> {
  const data = await postTier34<{ resolved?: ResolvedAcquire }>('/api/audiobook/acquire/download', {
    resolved: { ...resolved, title: options?.title ?? resolved.title },
    ...engineSecrets(),
  });
  if (!data?.resolved) throw new Error('Download failed — Sandbox Server required');
  return data.resolved;
}
