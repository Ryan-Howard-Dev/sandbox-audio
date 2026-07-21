/**
 * Tier 3/4 resolve + personal addon pack search.
 *
 * Built-in dev-test addons (SoundCloud, WebTorrent, IPFS, Radio Browser, Audius, Soulseek):
 * - Visible when Settings → Addons → Show Experimental Integrations is ON
 * - Auto-enabled when that toggle is turned on (see addonStorage.syncExperimentalAddons)
 * - Resolve via tier34-server addon routes
 * - Full streams only — preview URLs (audio-ssl) are filtered client-side
 *
 * User manifest addons (HTTPS JSON with search.endpoint) are always active when
 * installed + enabled — they race in search and playback same as builtins.
 */

import { isAirGapEnabled } from '../airGapMode';
import type { CandidateSource, MediaProvider, MediaTransport } from '../sandboxLayer1';
import {
  BUILTIN_ADDON_IDS,
  getEnabledAddons,
  isExperimentalAddonActive,
  loadAddons,
} from '../addonStorage';
import { isCatalogPreviewUrl } from '../displaySanitize';
import { loadPlaybackEngineSettings } from '../playbackEngineSettings';
import { loadShowExperimentalIntegrations } from '../sandboxSettings';
import { getTier34BaseUrl } from '../tier34/client';
import { isAllowedAddonSearchEndpoint } from './addonUrlValidation';

type ResolveRow = {
  id?: string;
  title?: string;
  artist?: string;
  url?: string;
  durationSeconds?: number;
  artworkUrl?: string;
  releaseYear?: string;
  sourceId?: string;
  resolveHint?: string;
  provider?: MediaProvider;
  transport?: MediaTransport;
};

type AddonManifest = {
  search?: {
    endpoint?: string;
    method?: 'GET' | 'POST';
    bodyTemplate?: string;
  };
  defaults?: {
    provider?: MediaProvider;
    transport?: MediaTransport;
  };
};

function rowToCandidate(
  row: ResolveRow,
  tier: 2 | 3 | 4,
  index: number,
  defaults?: { provider?: MediaProvider; transport?: MediaTransport },
): CandidateSource | null {
  const url = row.url?.trim();
  if (!url || isCatalogPreviewUrl(url)) return null;
  const isProxy = tier === 3;
  const isDebrid = tier === 4;
  const provider =
    row.provider ??
    defaults?.provider ??
    (isProxy ? 'proxy' : isDebrid ? 'debrid' : 'stream-proxy');
  const transport =
    row.transport ??
    defaults?.transport ??
    (isProxy ? 'proxy' : isDebrid ? 'debrid' : 'element-src');
  return {
    id: row.id ?? row.sourceId ?? `${provider}-${index}`,
    priority: tier === 2 ? 4 : isProxy ? 5 : 6,
    provider,
    transport,
    uri: url,
    bitrateKbps: isDebrid ? 1411 : isProxy ? 160 : 128,
    metadata: {
      title: row.title ?? 'Unknown Title',
      artist: row.artist ?? 'Unknown Artist',
      durationSeconds: row.durationSeconds ?? 0,
      artworkUrl: row.artworkUrl,
      releaseYear: row.releaseYear,
    },
    resolveHint: row.resolveHint,
  };
}

function applyManifestPlaceholders(
  template: string,
  query: string,
  config?: Record<string, string>,
): string {
  let out = template.replace(/\{query\}/g, query);
  if (config) {
    for (const [key, value] of Object.entries(config)) {
      out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
    }
  }
  return out;
}

async function postResolve(
  backendUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<CandidateSource[]> {
  const base = backendUrl.replace(/\/$/, '');
  if (!base) return [];
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: ResolveRow[]; candidates?: ResolveRow[] };
    const rows = data.results ?? data.candidates ?? [];
    const tier = path.includes('debrid') ? 4 : path.includes('proxy') ? 3 : 2;
    return rows
      .map((row, i) => rowToCandidate(row, tier, i))
      .filter((c): c is CandidateSource => c != null);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

async function postAddonResolve(
  path: string,
  body: Record<string, unknown>,
  defaults: { provider: MediaProvider; transport: MediaTransport },
): Promise<CandidateSource[]> {
  if (isAirGapEnabled()) return [];
  const base = getTier34BaseUrl().trim();
  if (!base) return [];
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 14_000);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: ResolveRow[] };
    return (data.results ?? [])
      .map((row, i) => rowToCandidate(row, 2, i, defaults))
      .filter((c): c is CandidateSource => c != null);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

/** Tier 3 — yt-dlp / Invidious / Piped proxy resolve via tier34 backend. */
export async function searchProxy(
  query: string,
  backendUrl?: string,
): Promise<CandidateSource[]> {
  if (isAirGapEnabled()) return [];
  const q = query.trim();
  if (!q) return [];
  const base = (backendUrl ?? getTier34BaseUrl()).trim();
  if (!base) return [];
  return postResolve(base, '/api/proxy/resolve', { query: q });
}

/** Tier 4 — Sandbox Indexer (built-in) + optional Prowlarr → Real-Debrid via tier34 backend. */
export async function searchDebrid(
  query: string,
  backendUrl?: string,
): Promise<CandidateSource[]> {
  if (isAirGapEnabled()) return [];
  const q = query.trim();
  if (!q) return [];
  const base = (backendUrl ?? getTier34BaseUrl()).trim();
  if (!base) return [];
  const engine = loadPlaybackEngineSettings();
  return postResolve(base, '/api/debrid/resolve', {
    query: q,
    prowlarrUrl: engine.prowlarrUrl,
    prowlarrApiKey: engine.prowlarrApiKey,
    realDebridApiKey: engine.realDebridApiKey,
  });
}

/** Unified Sandbox Indexer search — yt-dlp, archive, Torznab, optional Prowlarr. */
export async function searchSandboxIndexer(query: string): Promise<CandidateSource[]> {
  if (isAirGapEnabled()) return [];
  const q = query.trim();
  if (!q) return [];
  const { tier34IndexerSearch } = await import('../tier34/client');
  return tier34IndexerSearch(q);
}

/** SoundCloud — tier34 /api/addon/soundcloud/resolve (API + yt-dlp scsearch). */
export async function searchSoundCloudAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.soundcloud)) return [];
  const addon = loadAddons().find((a) => a.id === BUILTIN_ADDON_IDS.soundcloud);
  const clientId = addon?.config?.client_id?.trim() ?? '';
  return postAddonResolve(
    '/api/addon/soundcloud/resolve',
    { query: query.trim(), clientId, client_id: clientId },
    { provider: 'stream-proxy', transport: 'stream-proxy' },
  );
}

/** WebTorrent — tier34 magnet/RD or archive P2P fallback. */
export async function searchWebTorrentAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.webtorrent)) return [];
  const engine = loadPlaybackEngineSettings();
  return postAddonResolve(
    '/api/addon/webtorrent/resolve',
    {
      query: query.trim(),
      prowlarrUrl: engine.prowlarrUrl,
      prowlarrApiKey: engine.prowlarrApiKey,
      realDebridApiKey: engine.realDebridApiKey,
    },
    { provider: 'webtorrent', transport: 'p2p' },
  );
}

/** IPFS / mesh — tier34 archive content-addressable resolve. */
export async function searchIpfsAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.ipfs)) return [];
  return postAddonResolve(
    '/api/addon/ipfs/resolve',
    { query: query.trim() },
    { provider: 'ipfs', transport: 'p2p' },
  );
}

/** Radio Browser — tier34 live station search (play-only). */
export async function searchRadioBrowserAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.radioBrowser)) return [];
  const base = getTier34BaseUrl().trim();
  if (!base || isAirGapEnabled()) return [];
  return postAddonResolve(
    '/api/addon/radio-browser/search',
    { query: query.trim() },
    { provider: 'stream-proxy', transport: 'element-src' },
  );
}

/** Audius — tier34 decentralized CDN streams. */
export async function searchAudiusAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.audius)) return [];
  const addon = loadAddons().find((a) => a.id === BUILTIN_ADDON_IDS.audius);
  const apiKey = addon?.config?.api_key?.trim() ?? '';
  const appName = addon?.config?.app_name?.trim() ?? 'SandboxMusic';
  return postAddonResolve(
    '/api/addon/audius/resolve',
    {
      query: query.trim(),
      apiKey,
      api_key: apiKey,
      appName,
      app_name: appName,
    },
    { provider: 'stream-proxy', transport: 'stream-proxy' },
  );
}

/** Soulseek — tier34 slskd search (headless Soulseek network on server). */
export async function searchSoulseekAddon(query: string): Promise<CandidateSource[]> {
  if (!isExperimentalAddonActive(BUILTIN_ADDON_IDS.soulseek)) return [];
  return postAddonResolve(
    '/api/addon/soulseek/resolve',
    { query: query.trim() },
    { provider: 'stream-proxy', transport: 'stream-proxy' },
  );
}

/** Built-in dev-test pack only — requires experimental toggle. */
export async function searchBuiltinPackAddons(query: string): Promise<CandidateSource[]> {
  if (!loadShowExperimentalIntegrations()) return [];
  const q = query.trim();
  if (!q) return [];
  return (
    await Promise.all([
      searchSoundCloudAddon(q),
      searchWebTorrentAddon(q),
      searchIpfsAddon(q),
      searchRadioBrowserAddon(q),
      searchAudiusAddon(q),
      searchSoulseekAddon(q),
    ])
  ).flat();
}

async function fetchManifestSearch(
  addon: { id: string; tier: number; config?: Record<string, string> },
  manifest: AddonManifest,
  query: string,
): Promise<CandidateSource[]> {
  const endpoint = manifest.search?.endpoint;
  if (!endpoint) return [];
  if (!isAllowedAddonSearchEndpoint(endpoint)) return [];

  const url = applyManifestPlaceholders(
    endpoint.replace('{query}', encodeURIComponent(query)),
    query,
    addon.config,
  );
  const method = manifest.search?.method ?? 'GET';
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 14_000);

  try {
    const init: RequestInit = { signal: ctrl.signal };
    if (method === 'POST') {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      const bodyTemplate =
        manifest.search?.bodyTemplate ?? '{"query":"{query}"}';
      init.body = applyManifestPlaceholders(bodyTemplate, query, addon.config);
    }
    const searchRes = await fetch(url, init);
    if (!searchRes.ok) return [];
    const data = (await searchRes.json()) as {
      results?: ResolveRow[];
      tracks?: ResolveRow[];
      stations?: ResolveRow[];
    };
    const rows = data.results ?? data.tracks ?? data.stations ?? [];
    const tier = addon.tier >= 4 ? 4 : addon.tier >= 3 ? 3 : 2;
    const defaults = manifest.defaults;
    return rows
      .map((row, i) =>
        rowToCandidate(
          { ...row, id: row.id ?? `${addon.id}-${i}` },
          tier,
          i,
          defaults?.provider
            ? {
                provider: defaults.provider,
                transport: defaults.transport ?? 'element-src',
              }
            : undefined,
        ),
      )
      .filter((c): c is CandidateSource => c != null);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

/** User-installed HTTPS manifest addons — always active when enabled. */
export async function searchUserManifestAddons(query: string): Promise<CandidateSource[]> {
  if (isAirGapEnabled()) return [];
  const q = query.trim();
  if (!q) return [];

  const userAddons = getEnabledAddons().filter((a) => !a.builtIn && a.manifestUrl);
  if (userAddons.length === 0) return [];

  const manifestResults = await Promise.all(
    userAddons.map(async (addon) => {
      try {
        const res = await fetch(addon.manifestUrl);
        if (!res.ok) return [] as CandidateSource[];
        const manifest = (await res.json()) as AddonManifest;
        return fetchManifestSearch(addon, manifest, q);
      } catch {
        return [];
      }
    }),
  );

  return manifestResults.flat();
}

/** Run enabled personal-pack + manifest addon searches (tier 2). */
export async function searchEnabledAddons(query: string): Promise<CandidateSource[]> {
  const [fromPack, fromManifest] = await Promise.all([
    searchBuiltinPackAddons(query),
    searchUserManifestAddons(query),
  ]);
  return [...fromPack, ...fromManifest];
}
