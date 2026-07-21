/**
 * Tier 3/4 backend client — reads URL from Settings (sandbox_tier34_backend_url).
 */

import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { isCatalogPreviewUrl } from '../displaySanitize';
import { loadPlaybackEngineSettings } from '../playbackEngineSettings';
import { isCapacitorNative, isTauri } from '../platformEnv';
import { prefsGetItem, prefsSetItem } from '../prefsStorage';
import {
  loadSandboxServerMode,
  loadSandboxServerRemoteUrl,
  SANDBOX_SERVER_ANCHOR_URL,
} from '../sandboxSettings';
import {
  CACHE_KEYS,
  readResponseCache,
  writeResponseCache,
  type CacheReadResult,
} from '../responseCache';

export const TIER34_BACKEND_KEY = 'sandbox_tier34_backend_url';
export const TIER34_DEFAULT_URL = 'http://localhost:3001';
const TIER34_REACHABLE_TTL_MS = 30_000;
const TIER34_HEALTH_TIMEOUT_MS = 3_000;

let tier34ReachableCache: { ok: boolean; at: number } | null = null;

/** Cache last /health probe — used for catalog preview vs tier-3/4 resolve on desktop. */
export function noteTier34Reachable(ok: boolean): void {
  tier34ReachableCache = { ok, at: Date.now() };
}

/** True when a recent health probe succeeded and a backend URL is configured. */
export function isTier34ReachableCached(): boolean {
  return isServerReachableCached();
}

/** Alias — hybrid resolution uses Sandbox Server terminology. */
export function isServerReachableCached(): boolean {
  if (!getTier34BaseUrl().trim()) return false;
  if (!tier34ReachableCache) return false;
  if (Date.now() - tier34ReachableCache.at > TIER34_REACHABLE_TTL_MS) return false;
  return tier34ReachableCache.ok;
}

/** Probe /health with 3s timeout — refreshes 30s reachability cache. Fail closed when offline. */
export async function isServerReachable(): Promise<boolean> {
  return refreshTier34Reachability();
}

/** Probe /health and refresh reachability cache (fire-and-forget safe). */
export async function refreshTier34Reachability(): Promise<boolean> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) {
    noteTier34Reachable(false);
    return false;
  }
  const ok = await tier34HealthOk();
  noteTier34Reachable(ok);
  return ok;
}

export const OAUTH_TOKEN_KEY = 'sandbox_oauth_token';
export const SANDBOX_CLIENT_VERSION = '1.0.0';
export const SANDBOX_CLIENT_ID = `sandbox-music/${SANDBOX_CLIENT_VERSION}`;

/** Header for tier34 stream fetches — bypasses Interminable Tide scraper heuristics. */
export function getSandboxClientHeader(): Record<string, string> {
  return { 'X-Sandbox-Client': SANDBOX_CLIENT_ID };
}

/** Query fallback for audio elements / ExoPlayer that cannot send custom headers. */
export function appendSandboxClientQuery(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const isAbsolute = /^https?:\/\//i.test(trimmed);
  try {
    const parsed = new URL(trimmed, isAbsolute ? undefined : 'http://sandbox.local');
    const path = parsed.pathname;
    if (!path.includes('/api/') && !path.includes('/rest/')) return trimmed;
    if (!parsed.searchParams.has('sb_client')) {
      parsed.searchParams.set('sb_client', SANDBOX_CLIENT_ID);
    }
    if (isAbsolute) return parsed.toString();
    const q = parsed.searchParams.toString();
    return `${path}${q ? `?${q}` : ''}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

export function sandboxStreamFetchInit(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...getSandboxClientHeader(),
      ...(init?.headers ?? {}),
    },
  };
}

function standaloneShellWithoutBundledServer(): boolean {
  return isCapacitorNative() || isTauri();
}

export function getTier34BaseUrl(): string {
  try {
    const explicit = prefsGetItem(TIER34_BACKEND_KEY)?.trim();
    if (explicit) return explicit;

    const mode = loadSandboxServerMode();
    if (mode === 'remote') {
      const remote = loadSandboxServerRemoteUrl().trim();
      if (remote) return remote;
    }
    if (mode === 'anchor') {
      return SANDBOX_SERVER_ANCHOR_URL;
    }

    // Tauri/Capacitor bundles do not embed tier34 — empty until the user configures a server.
    return standaloneShellWithoutBundledServer() ? '' : TIER34_DEFAULT_URL;
  } catch {
    return standaloneShellWithoutBundledServer() ? '' : TIER34_DEFAULT_URL;
  }
}

/** Persist Sandbox Server URL and notify listeners (device secret pull, health checks). */
export function saveTier34BackendUrl(url: string): void {
  prefsSetItem(TIER34_BACKEND_KEY, url.trim());
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

/** LAN-reachable tier34 base — swaps localhost for the page hostname for speaker pulls. */
export function getTier34LanBaseUrl(): string {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  try {
    const parsed = new URL(base);
    const host = parsed.hostname.toLowerCase();
    if (
      (host === 'localhost' || host === '127.0.0.1' || host === '::1') &&
      typeof window !== 'undefined' &&
      window.location.hostname
    ) {
      parsed.hostname = window.location.hostname;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return base;
  }
}

export type CastDeviceType = 'upnp' | 'sonos' | 'remote_cast';

export type CastDevice = {
  id: string;
  name: string;
  ip: string;
  type: CastDeviceType;
  location?: string;
};

export async function tier34CastDiscover(): Promise<
  Tier34FetchResult<{ devices: CastDevice[] }>
> {
  const online = await tier34HealthOk();
  if (!online) {
    return { ok: false, error: 'Start your Sandbox Server to enable speaker streaming' };
  }
  const result = await tier34FetchResult<{ devices?: CastDevice[] }>('/api/cast/discover');
  if (result.ok === false) {
    return result;
  }
  return {
    ok: true,
    data: { devices: result.data.devices ?? [] },
  };
}

export async function tier34SonosPlay(input: {
  ip: string;
  streamUrl: string;
  title: string;
  artist: string;
}): Promise<Tier34FetchResult<{ ok: boolean }>> {
  if (input.streamUrl.startsWith('blob:')) {
    return { ok: false, error: 'blob URLs cannot be cast to network speakers' };
  }
  return tier34FetchResult<{ ok: boolean }>('/api/cast/sonos/play', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function tier34SonosPause(ip: string): Promise<Tier34FetchResult<{ ok: boolean }>> {
  return tier34FetchResult<{ ok: boolean }>('/api/cast/sonos/pause', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  });
}

export async function tier34SonosVolume(
  ip: string,
  volume: number,
): Promise<Tier34FetchResult<{ ok: boolean; volume?: number }>> {
  return tier34FetchResult<{ ok: boolean; volume?: number }>('/api/cast/sonos/volume', {
    method: 'POST',
    body: JSON.stringify({ ip, volume }),
  });
}

export function getOAuthToken(): string {
  try {
    return localStorage.getItem(OAUTH_TOKEN_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setOAuthToken(token: string): void {
  localStorage.setItem(OAUTH_TOKEN_KEY, token);
  void import('../deviceSecretSync').then(({ notifyDeviceSecretChanged }) => {
    notifyDeviceSecretChanged(OAUTH_TOKEN_KEY);
  });
}

export type Tier34FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

const TIER34_DEFAULT_TIMEOUT_MS = 12_000;

async function tier34FetchResult<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = TIER34_DEFAULT_TIMEOUT_MS,
): Promise<Tier34FetchResult<T>> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) {
    return { ok: false as const, error: 'No Sandbox Server URL configured' };
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: string };
        detail = body.error?.trim() ?? '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      return {
        ok: false as const,
        status: res.status,
        error: detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true as const, data: (await res.json()) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false as const,
      error: msg.includes('abort') ? 'Request timed out' : msg,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function tier34Fetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = TIER34_DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const result = await tier34FetchResult<T>(path, init, timeoutMs);
  return result.ok ? result.data : null;
}

export async function tier34HealthOk(): Promise<boolean> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) {
    noteTier34Reachable(false);
    return false;
  }
  const data = await tier34Fetch<{ ok?: boolean }>('/health', undefined, TIER34_HEALTH_TIMEOUT_MS);
  const ok = Boolean(data?.ok);
  noteTier34Reachable(ok);
  return ok;
}

export type Tier34HealthStatus = {
  ok: boolean;
  meilisearch?: boolean;
  ytdlp?: boolean;
};

export async function tier34HealthStatus(): Promise<Tier34HealthStatus> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) {
    noteTier34Reachable(false);
    return { ok: false };
  }
  const data = await tier34Fetch<{ ok?: boolean; meilisearch?: boolean; ytdlp?: boolean }>(
    '/health',
    undefined,
    TIER34_HEALTH_TIMEOUT_MS,
  );
  const ok = Boolean(data?.ok);
  noteTier34Reachable(ok);
  return {
    ok,
    meilisearch: data?.meilisearch,
    ytdlp: data?.ytdlp,
  };
}

export type SelfHostServiceStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export type SelfHostStatus = {
  tier34: SelfHostServiceStatus;
  meilisearch: SelfHostServiceStatus;
  ytdlp: SelfHostServiceStatus;
};

function chipFromBool(value: boolean | undefined, tier34Up: boolean): SelfHostServiceStatus {
  if (!tier34Up) return value === true ? 'OFFLINE' : 'UNKNOWN';
  if (value === true) return 'ONLINE';
  if (value === false) return 'OFFLINE';
  return 'UNKNOWN';
}

/** Poll tier34 /health for self-host status chips (Settings). */
export async function pollSelfHostStatus(backendUrl?: string): Promise<SelfHostStatus> {
  const base = (backendUrl ?? getTier34BaseUrl()).replace(/\/$/, '');
  if (!base) {
    return { tier34: 'OFFLINE', meilisearch: 'UNKNOWN', ytdlp: 'UNKNOWN' };
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!res.ok) {
      return { tier34: 'OFFLINE', meilisearch: 'UNKNOWN', ytdlp: 'UNKNOWN' };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      meilisearch?: boolean;
      ytdlp?: boolean;
    };
    const tier34Up = Boolean(data.ok);
    return {
      tier34: tier34Up ? 'ONLINE' : 'OFFLINE',
      meilisearch: chipFromBool(data.meilisearch, tier34Up),
      ytdlp: chipFromBool(data.ytdlp, tier34Up),
    };
  } catch {
    return { tier34: 'OFFLINE', meilisearch: 'UNKNOWN', ytdlp: 'UNKNOWN' };
  } finally {
    window.clearTimeout(timer);
  }
}

export type Tier34DlnaSettings = {
  enabled: boolean;
  envEnabled: boolean;
  runtimeOverride: boolean | null;
  requiresRestart: boolean;
  baseUrl: string;
  friendlyName: string;
};

export async function tier34GetDlnaSettings(): Promise<Tier34DlnaSettings | null> {
  return tier34Fetch<Tier34DlnaSettings>('/api/dlna/settings');
}

export async function tier34SetDlnaEnabled(
  enabled: boolean,
): Promise<Tier34FetchResult<{ ok: boolean; enabled: boolean }>> {
  return tier34FetchResult<{ ok: boolean; enabled: boolean }>('/api/dlna/enable', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export type MediaGraphStats = {
  envelopes: number;
  sources: number;
  hashes: number;
  dedupedBytes: number;
  duplicateHashes?: Array<{ hash: string; refCount: number }>;
};

export async function tier34MediaGraphStats(): Promise<MediaGraphStats | null> {
  return tier34Fetch<MediaGraphStats>('/api/media-graph/stats');
}

export async function tier34ReindexSearch(): Promise<
  Tier34FetchResult<{ indexed?: number; ok?: boolean; error?: string }>
> {
  return tier34FetchResult<{ indexed?: number; ok?: boolean; error?: string }>(
    '/api/search/reindex',
    { method: 'POST' },
  );
}

type Tier34SearchRow = {
  envelopeId: string;
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  provider: MediaEnvelope['provider'];
  transport: MediaEnvelope['transport'];
  sourceId: string;
  mimeType?: string;
  artworkUrl?: string;
  releaseYear?: string;
  resolveHint?: string;
};

function rowToEnvelope(row: Tier34SearchRow): MediaEnvelope {
  return {
    envelopeId: row.envelopeId,
    title: row.title,
    artist: row.artist,
    url: row.url,
    durationSeconds: row.durationSeconds ?? 0,
    provider: row.provider,
    transport: row.transport,
    sourceId: row.sourceId,
    mimeType: row.mimeType,
    artworkUrl: row.artworkUrl,
    releaseYear: row.releaseYear,
  };
}

function candidateToEnvelope(candidate: CandidateSource): MediaEnvelope {
  return {
    envelopeId: candidate.id,
    title: candidate.metadata?.title ?? 'Unknown Title',
    artist: candidate.metadata?.artist ?? 'Unknown Artist',
    url: candidate.uri ?? '',
    durationSeconds: candidate.metadata?.durationSeconds ?? 0,
    provider: candidate.provider,
    transport: candidate.transport,
    sourceId: candidate.id,
    mimeType: candidate.mimeType,
    artworkUrl: candidate.metadata?.artworkUrl,
    releaseYear: candidate.metadata?.releaseYear,
  };
}

type ResolveRow = {
  id?: string;
  title?: string;
  artist?: string;
  url?: string;
  durationSeconds?: number;
  artworkUrl?: string;
  releaseYear?: string;
  sourceId?: string;
};

function rowToCandidate(row: ResolveRow, tier: 3 | 4, index: number): CandidateSource | null {
  const url = row.url?.trim();
  if (!url) return null;
  const isProxy = tier === 3;
  return {
    id: row.id ?? row.sourceId ?? `${isProxy ? 'proxy' : 'debrid'}-${index}`,
    priority: isProxy ? 5 : 6,
    provider: isProxy ? 'proxy' : 'debrid',
    transport: isProxy ? 'proxy' : 'debrid',
    uri: url,
    bitrateKbps: isProxy ? 160 : 1411,
    metadata: {
      title: row.title ?? 'Unknown Title',
      artist: row.artist ?? 'Unknown Artist',
      durationSeconds: row.durationSeconds ?? 0,
      artworkUrl: row.artworkUrl,
      releaseYear: row.releaseYear,
    },
  };
}

async function postResolveCandidates(
  path: string,
  body: Record<string, unknown>,
): Promise<CandidateSource[]> {
  const data = await tier34Fetch<{ results?: ResolveRow[] }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const tier = path.includes('proxy') ? 3 : 4;
  return (data?.results ?? [])
    .map((row, i) => rowToCandidate(row, tier, i))
    .filter((c): c is CandidateSource => c != null);
}

export async function tier34SearchProxy(query: string): Promise<MediaEnvelope[]> {
  const candidates = await postResolveCandidates('/api/proxy/resolve', { query: query.trim() });
  return candidates.map(candidateToEnvelope).filter((e) => e.url);
}

export async function tier34SearchDebrid(query: string): Promise<MediaEnvelope[]> {
  const engine = loadPlaybackEngineSettings();
  const candidates = await postResolveCandidates('/api/debrid/resolve', {
    query: query.trim(),
    prowlarrUrl: engine.prowlarrUrl,
    prowlarrApiKey: engine.prowlarrApiKey,
    realDebridApiKey: engine.realDebridApiKey,
  });
  return candidates.map(candidateToEnvelope).filter((e) => e.url);
}

export async function testYtdlpBackend(
  backendUrl?: string,
): Promise<{ ok: boolean; detail: string }> {
  const ok = await tier34HealthOk();
  return ok
    ? { ok: true, detail: `Backend online at ${(backendUrl ?? getTier34BaseUrl()).replace(/\/$/, '')}` }
    : { ok: false, detail: 'Sandbox Server unreachable — check Settings → Addons → Server URL' };
}

export async function testProwlarrBackend(): Promise<{ ok: boolean; detail: string }> {
  const engine = loadPlaybackEngineSettings();
  const data = await tier34Fetch<{ ok?: boolean; detail?: string }>(
    '/api/debrid/test/prowlarr',
    {
      method: 'POST',
      body: JSON.stringify({
        prowlarrUrl: engine.prowlarrUrl,
        prowlarrApiKey: engine.prowlarrApiKey,
      }),
    },
  );
  return {
    ok: Boolean(data?.ok),
    detail: data?.detail ?? 'Test request failed',
  };
}

export async function testRealDebridBackend(): Promise<{ ok: boolean; detail: string }> {
  const engine = loadPlaybackEngineSettings();
  const data = await tier34Fetch<{ ok?: boolean; detail?: string }>(
    '/api/debrid/test/realdebrid',
    {
      method: 'POST',
      body: JSON.stringify({ realDebridApiKey: engine.realDebridApiKey }),
    },
  );
  return {
    ok: Boolean(data?.ok),
    detail: data?.detail ?? 'Test request failed',
  };
}

export type TorznabEndpointConfig = {
  name: string;
  url: string;
  apiKey?: string;
};

export type SandboxIndexerStatus = {
  ok?: boolean;
  builtIn?: { ytdlp: boolean; archive: boolean };
  torznabEndpoints?: Array<{ name: string; url: string; hasApiKey: boolean }>;
  prowlarrConfigured?: boolean;
  sources?: string[];
};

export async function tier34IndexerStatus(): Promise<SandboxIndexerStatus | null> {
  return tier34Fetch<SandboxIndexerStatus>('/api/indexer/status');
}

export async function tier34IndexerConfigure(
  torznabEndpoints: TorznabEndpointConfig[],
): Promise<{ ok: boolean; torznabEndpoints?: number; error?: string }> {
  const data = await tier34Fetch<{ ok?: boolean; torznabEndpoints?: number; error?: string }>(
    '/api/indexer/configure',
    {
      method: 'POST',
      body: JSON.stringify({ torznabEndpoints }),
    },
  );
  return {
    ok: Boolean(data?.ok),
    torznabEndpoints: data?.torznabEndpoints,
    error: data?.error,
  };
}

export async function tier34IndexerSearch(query: string): Promise<CandidateSource[]> {
  const q = query.trim();
  if (!q) return [];
  const engine = loadPlaybackEngineSettings();
  const params = new URLSearchParams({ q });
  if (engine.prowlarrUrl.trim()) params.set('prowlarrUrl', engine.prowlarrUrl.trim());
  if (engine.prowlarrApiKey.trim()) params.set('prowlarrApiKey', engine.prowlarrApiKey.trim());
  const data = await tier34Fetch<{ results?: ResolveRow[] }>(
    `/api/indexer/search?${params.toString()}`,
  );
  return (data?.results ?? [])
    .map((row, i) => rowToCandidate(row, row.url?.includes('/api/proxy/') ? 3 : 4, i))
    .filter((c): c is CandidateSource => c != null);
}

export async function testSandboxIndexerBackend(): Promise<{ ok: boolean; detail: string }> {
  const status = await tier34IndexerStatus();
  if (!status?.builtIn) {
    return { ok: false, detail: 'Sandbox Server unreachable — check Settings → Addons → Server URL' };
  }
  const parts = ['archive.org'];
  if (status.builtIn.ytdlp) parts.push('yt-dlp');
  if ((status.torznabEndpoints?.length ?? 0) > 0) parts.push(`${status.torznabEndpoints!.length} Torznab`);
  if (status.prowlarrConfigured) parts.push('Prowlarr');
  return { ok: true, detail: `Built-in: ${parts.join(', ')}` };
}

export async function tier34SpectralCheck(
  url: string,
  title: string,
  artist: string,
): Promise<{ accepted: boolean; entropy: number }> {
  const data = await tier34Fetch<{ accepted: boolean; entropy: number }>(
    '/api/analyze/spectral',
    { method: 'POST', body: JSON.stringify({ url, title, artist }) },
  );
  return data ?? { accepted: true, entropy: 0.5 };
}

export async function tier34FingerprintMatch(
  title: string,
  artist: string,
  durationSeconds: number,
  opts?: { fingerprint?: string; contentHash?: string },
): Promise<{
  matched: boolean;
  fingerprint: string;
  matchScore: number;
  musicbrainzRecordingId?: string;
  source?: string;
}> {
  const data = await tier34Fetch<{
    matched: boolean;
    fingerprint: string;
    matchScore: number;
    musicbrainzRecordingId?: string;
    source?: string;
  }>('/api/fingerprint/match', {
    method: 'POST',
    body: JSON.stringify({
      title,
      artist,
      durationSeconds,
      fingerprint: opts?.fingerprint,
      contentHash: opts?.contentHash,
    }),
  });
  return data ?? { matched: false, fingerprint: '', matchScore: 0 };
}

export async function tier34HealDeadSource(
  envelope: MediaEnvelope,
): Promise<MediaEnvelope | null> {
  const data = await tier34Fetch<{ healed: boolean; envelope: MediaEnvelope | null }>(
    '/api/heal/dead-source',
    { method: 'POST', body: JSON.stringify({ envelope }) },
  );
  if (data?.healed && data.envelope?.url) return data.envelope;
  return null;
}

export async function tier34DhtResolve(
  title: string,
  artist: string,
  hash?: string,
): Promise<MediaEnvelope | null> {
  const data = await tier34Fetch<{
    playbackUrl: string | null;
    streams?: Tier34SearchRow[];
  }>('/api/dht/resolve', {
    method: 'POST',
    body: JSON.stringify({ hash, title, artist }),
  });
  const streams = (data?.streams ?? []).filter(
    (row) => row.url?.trim() && !isCatalogPreviewUrl(row.url),
  );
  const url = data?.playbackUrl && !isCatalogPreviewUrl(data.playbackUrl)
    ? data.playbackUrl
    : streams[0]?.url;
  if (!url || isCatalogPreviewUrl(url)) return null;
  const row = streams[0];
  return row
    ? rowToEnvelope(row)
    : {
        envelopeId: `dht-${Date.now()}`,
        title,
        artist,
        url,
        durationSeconds: 0,
        provider: 'dht-swarm',
        transport: 'element-src',
        sourceId: hash ?? 'dht',
      };
}

export async function tier34StemFailover(
  sources: Array<{ id: string; uri?: string | null; provider?: string }>,
  failedSourceId: string,
  title: string,
  artist: string,
): Promise<string | null> {
  const data = await tier34Fetch<{
    activeStem?: { uri?: string | null };
    sources?: Array<{ uri?: string | null }>;
  }>('/api/stem/failover', {
    method: 'POST',
    body: JSON.stringify({ sources, failedSourceId, title, artist }),
  });
  const uri = data?.activeStem?.uri ?? data?.sources?.[0]?.uri;
  return uri ?? null;
}

export async function tier34SonicDna(
  title: string,
  artist: string,
  genre?: string,
  durationSeconds?: number,
): Promise<{ profileId: string; vector: number[] } | null> {
  return tier34Fetch('/api/sonic-dna/profile', {
    method: 'POST',
    body: JSON.stringify({ title, artist, genre, durationSeconds }),
  });
}

export function oauthAuthorizeUrl(provider: string): string {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  return `${base}/api/oauth/${provider}/authorize`;
}

export async function tier34OAuthPlaylists(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    tracks: Array<{ title: string; artist: string; album: string; duration: number }>;
  }>
> {
  const token = getOAuthToken();
  const base = getTier34BaseUrl().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/oauth/playlists?token=${encodeURIComponent(token)}`, {
      headers: { 'X-Sandbox-Token': token },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { playlists?: [] };
    return data.playlists ?? [];
  } catch {
    return [];
  }
}

export interface FeedItem {
  id: string;
  title: string;
  artist: string;
  url: string;
  artworkUrl?: string;
  releasedAt: string;
  section: 'new' | 'week' | 'month';
  envelopeId?: string;
  provider?: string;
}

export const FEED_FETCH_TIMEOUT_MS = 45_000;

export type Tier34FeedFetchResult =
  | { ok: true; items: FeedItem[] }
  | { ok: false; error: string; url: string };

export type CachedTier34Feed = {
  items: FeedItem[];
  baseUrl: string;
};

export function readTier34FeedCache(): CacheReadResult<CachedTier34Feed> | null {
  const hit = readResponseCache<CachedTier34Feed>(CACHE_KEYS.TIER34_FEED);
  if (!hit) return null;
  const currentBase = getTier34BaseUrl().replace(/\/$/, '');
  if (hit.data.baseUrl !== currentBase) return null;
  return hit;
}

export function writeTier34FeedCache(items: FeedItem[]): void {
  writeResponseCache(CACHE_KEYS.TIER34_FEED, {
    items,
    baseUrl: getTier34BaseUrl().replace(/\/$/, ''),
  });
}

export async function tier34FetchFeedResult(): Promise<Tier34FeedFetchResult> {
  const url = getTier34BaseUrl().replace(/\/$/, '');
  const result = await tier34FetchResult<{ items?: FeedItem[] }>(
    '/api/feed',
    undefined,
    FEED_FETCH_TIMEOUT_MS,
  );
  if (result.ok === false) {
    return { ok: false, error: result.error, url };
  }
  const items = result.data.items ?? [];
  writeTier34FeedCache(items);
  return { ok: true, items };
}

/** @deprecated Prefer tier34FetchFeedResult for error handling. */
export async function tier34FetchFeed(): Promise<FeedItem[]> {
  const result = await tier34FetchFeedResult();
  return result.ok ? result.items : [];
}

export interface MixItem {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  seedQuery: string;
}

export async function tier34FetchMixes(lockerTitles: string[]): Promise<MixItem[]> {
  const data = await tier34Fetch<{ mixes?: MixItem[] }>('/api/mixes', {
    method: 'POST',
    body: JSON.stringify({ lockerTitles }),
  });
  return data?.mixes ?? [];
}

export interface VideoItem {
  id: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  watchUrl: string;
}

export async function tier34FetchVideos(query?: string): Promise<VideoItem[]> {
  const q = encodeURIComponent(query ?? 'music video');
  const data = await tier34Fetch<{ videos?: VideoItem[] }>(`/api/videos?q=${q}`);
  return data?.videos ?? [];
}

export function peerSyncWsUrl(room = 'default'): string {
  const base = getTier34BaseUrl().replace(/^http/, 'ws').replace(/\/$/, '');
  return `${base}/peer-sync?room=${encodeURIComponent(room)}`;
}

export type Tier34SearchHit = {
  id: string;
  envelopeId: string;
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  genre?: string;
  year?: string;
  label?: string;
  hash: string;
  source: string;
  lossless?: boolean;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
};

export type LockerSearchFilters = {
  artist?: string;
  genre?: string;
  year?: string;
  source?: string;
  lossless?: boolean;
  releaseGroupId?: string;
};

export type LockerSearchFacets = Record<string, Record<string, number>>;

export type LockerSearchMode = 'tracks' | 'albums' | 'artists' | 'collections';

export type LockerSearchResponse = {
  hits: Tier34SearchHit[];
  ok: boolean;
  facetDistribution?: LockerSearchFacets;
  estimatedTotalHits?: number;
};

/** Search locker via Meilisearch proxy (graceful offline fallback). */
export async function tier34SearchLocker(
  query: string,
  options?: {
    limit?: number;
    filters?: LockerSearchFilters;
    facets?: string[];
  },
): Promise<LockerSearchResponse> {
  const q = encodeURIComponent(query.trim());
  const params = new URLSearchParams({ q: query.trim(), limit: String(options?.limit ?? 40) });

  const filters = options?.filters;
  if (filters?.artist) params.set('artist', filters.artist);
  if (filters?.genre) params.set('genre', filters.genre);
  if (filters?.year) params.set('year', filters.year);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.releaseGroupId) params.set('releaseGroupId', filters.releaseGroupId);
  if (filters?.lossless === true) params.set('lossless', 'true');
  if (filters?.lossless === false) params.set('lossless', 'false');
  if (options?.facets?.length) params.set('facets', options.facets.join(','));

  const data = await tier34Fetch<{
    hits?: Tier34SearchHit[];
    ok?: boolean;
    facetDistribution?: LockerSearchFacets;
    estimatedTotalHits?: number;
  }>(`/api/search?${params.toString()}`);
  return {
    hits: data?.hits ?? [],
    ok: Boolean(data?.ok),
    facetDistribution: data?.facetDistribution,
    estimatedTotalHits: data?.estimatedTotalHits,
  };
}

export type EnvelopeSource = {
  id: number;
  envelopeId: string;
  origin: 'youtube' | 'debrid' | 'local' | 'proxy' | 'local-import' | string;
  uri: string | null;
  contentHash: string;
  addedAt: number;
};

/** Sources for an envelope (dedup / multi-source UI). */
export async function tier34EnvelopeSources(
  envelopeId: string,
): Promise<EnvelopeSource[]> {
  const data = await tier34Fetch<{ sources?: EnvelopeSource[] }>(
    `/api/media-graph/envelope/${encodeURIComponent(envelopeId)}/sources`,
  );
  return data?.sources ?? [];
}

export type IngestionWatchStatus = {
  enabled: boolean;
  path: string;
  filesProcessed: number;
  filesSkipped: number;
  lastEventAt: number | null;
  watching: boolean;
};

export type Tier34StorageInfo = {
  storageRoot: string;
  blobsDir: string;
  configurableViaEnv: 'TIER34_STORAGE_PATH';
};

export async function tier34GetStorageInfo(): Promise<Tier34StorageInfo | null> {
  return tier34Fetch<Tier34StorageInfo>('/api/locker/storage-info');
}

export async function tier34GetIngestionWatch(): Promise<IngestionWatchStatus | null> {
  return tier34Fetch<IngestionWatchStatus>('/api/ingestion/watch');
}

export async function tier34SetIngestionWatch(input: {
  enabled?: boolean;
  path?: string;
}): Promise<IngestionWatchStatus | null> {
  return tier34Fetch<IngestionWatchStatus>('/api/ingestion/watch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function tier34SetIngestionWatchDetailed(input: {
  enabled?: boolean;
  path?: string;
}): Promise<Tier34FetchResult<IngestionWatchStatus>> {
  return tier34FetchResult<IngestionWatchStatus>('/api/ingestion/watch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type InterminableTideMode = 'off' | 'chaff' | 'jitter' | 'both';

export type DefenseProtocolStatus = {
  enabled: boolean;
  envDefault: boolean;
  configurableViaEnv: 'TIER34_DEFENSE_PROTOCOL';
  interminableTide: InterminableTideMode;
  interminableTideEnv: 'TIER34_INTERMINABLE_TIDE';
  defenseStrict: boolean;
  defenseStrictEnv: 'TIER34_DEFENSE_STRICT';
  updatedAt: number | null;
};

export async function tier34GetDefenseProtocol(): Promise<DefenseProtocolStatus | null> {
  return tier34Fetch<DefenseProtocolStatus>('/api/security/defense-protocol');
}

export async function tier34SetDefenseProtocol(
  enabled: boolean,
): Promise<Tier34FetchResult<DefenseProtocolStatus>> {
  return tier34FetchResult<DefenseProtocolStatus>('/api/security/defense-protocol', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function tier34ScrobbleRelay(input: {
  method: string;
  params: Record<string, string>;
  apiKey: string;
  sessionKey: string;
}): Promise<Tier34FetchResult<{ error?: number; message?: string }>> {
  return tier34FetchResult('/api/scrobble/relay', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type TasteShareRow = {
  id: string;
  contentHash: string;
  storedAt: number;
  manifest: unknown;
};

/** Store signed taste recipe on LAN Sandbox Server (hash id). */
export async function tier34ShareTasteManifest(manifest: unknown): Promise<TasteShareRow> {
  const data = await tier34Fetch<TasteShareRow>('/api/taste/share', {
    method: 'POST',
    body: JSON.stringify({ manifest }),
  });
  if (!data?.id) throw new Error('Taste share store failed');
  return data;
}

/** Retrieve signed taste recipe from LAN Sandbox Server by id. */
export async function tier34FetchTasteManifest(id: string): Promise<TasteShareRow | null> {
  const data = await tier34Fetch<TasteShareRow>(`/api/taste/${encodeURIComponent(id.trim())}`);
  return data?.manifest ? data : null;
}

export type PlaylistSharePublicRow = {
  id: string;
  contentHash: string;
  storedAt: number;
  updatedAt: number;
  manifest: {
    schemaVersion: 1;
    name: string;
    description?: string;
    updatedAt: number;
    collaborative: boolean;
    tracks: Array<{
      title: string;
      artist: string;
      album?: string;
      envelopeId?: string;
      url?: string;
      durationSeconds?: number;
    }>;
  };
};

export type PlaylistSharePublishRow = PlaylistSharePublicRow & {
  editToken?: string;
};

/** Publish playlist manifest to LAN Sandbox Server. */
export async function tier34PublishPlaylistShare(
  manifest: PlaylistSharePublicRow['manifest'],
): Promise<PlaylistSharePublishRow> {
  const data = await tier34Fetch<PlaylistSharePublishRow>('/api/playlists/share', {
    method: 'POST',
    body: JSON.stringify({ manifest }),
  });
  if (!data?.id) throw new Error('Playlist share store failed');
  return data;
}

/** Fetch shared playlist manifest (view-only). */
export async function tier34FetchSharedPlaylist(id: string): Promise<PlaylistSharePublicRow | null> {
  const data = await tier34Fetch<PlaylistSharePublicRow>(
    `/api/playlists/share/${encodeURIComponent(id.trim())}`,
  );
  return data?.manifest ? data : null;
}

/** Push collaborative playlist update with edit token. */
export async function tier34UpdateSharedPlaylist(
  id: string,
  editToken: string,
  manifest: PlaylistSharePublicRow['manifest'],
): Promise<PlaylistSharePublicRow> {
  const data = await tier34Fetch<PlaylistSharePublicRow>(
    `/api/playlists/share/${encodeURIComponent(id.trim())}`,
    {
      method: 'PUT',
      headers: { 'X-Playlist-Edit-Token': editToken.trim() },
      body: JSON.stringify({ manifest }),
    },
  );
  if (!data?.id) throw new Error('Playlist share update failed');
  return data;
}

export type TmpfsCacheStatus = {
  cacheDir: string;
  maxBytes: number;
  usedBytes: number;
  entries: number;
  staging: boolean;
  queued: number;
};

/** Ask tier34 to stage upcoming locker tracks into tmpfs (fire-and-forget). */
export async function tier34StagePlaybackQueue(input: {
  trackIds?: string[];
  envelopeIds?: string[];
}): Promise<Tier34FetchResult<{ ok: boolean; accepted?: number; queued?: number }>> {
  const trackIds = (input.trackIds ?? []).map((id) => id.trim()).filter(Boolean);
  const envelopeIds = (input.envelopeIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (trackIds.length === 0 && envelopeIds.length === 0) {
    return { ok: true, data: { ok: true, accepted: 0, queued: 0 } };
  }
  return tier34FetchResult('/api/cache/stage-queue', {
    method: 'POST',
    body: JSON.stringify({ trackIds, envelopeIds }),
  });
}

export async function tier34GetTmpfsCacheStatus(): Promise<TmpfsCacheStatus | null> {
  return tier34Fetch<TmpfsCacheStatus>('/api/cache/status');
}
