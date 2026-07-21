/**
 * Ephemeral stream cache — temporary local audio blobs for replay without
 * re-resolving or full Locker download (no credits/metadata enrichment).
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { fetchWithTimeout } from './fetchWithTimeout';
import { isCatalogPreviewUrl } from './displaySanitize';
import {
  loadAggressiveCacheMaxMb,
  loadAggressiveOfflineCacheEnabled,
  loadStreamCacheEnabled,
  loadStreamCacheLimitMb,
  MOBILE_RESOLUTION_CACHE_TTL_MS,
  STREAM_CACHE_TTL_MS,
} from './sandboxSettings';
import {
  appendSandboxClientQuery,
  getTier34BaseUrl,
  sandboxStreamFetchInit,
} from './tier34/client';

const DB_NAME = 'SandboxStreamCache';
const STORE_NAME = 'tracks';
const AUDIO_FETCH_TIMEOUT_MS = 180_000;
const PREFETCH_FETCH_TIMEOUT_MS = 600_000;

export type PrefetchProgressCallback = (progress: number, phase: 'probe' | 'download') => void;

export type AggressivePrefetchResult =
  | { ok: true; envelope: MediaEnvelope; fromCache: boolean }
  | { ok: false; reason: 'disabled' | 'local' | 'too_large' | 'fetch_failed' | 'no_url' };

export type StreamCacheEntry = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  audioBlob: Blob;
  cachedAt: number;
  lastPlayedAt: number;
  sizeBytes: number;
  sourceTier?: string;
  expiresAt: number;
  mimeType?: string;
  durationSeconds?: number;
  artworkUrl?: string;
};

export type StreamCacheUsage = {
  bytes: number;
  trackCount: number;
};

/** Lightweight URI metadata cache for hybrid resolution (mobile / server hits). */
export type CachedStream = {
  query: string;
  uri: string;
  source: 'locker' | 'cache' | 'server' | 'mobile' | 'preview';
  resolvedAt: number;
  expiresAt: number;
};

const URI_CACHE_KEY = 'sandbox_resolution_uri_cache_v1';
const URI_CACHE_MAX = 200;

function readUriCacheRows(): CachedStream[] {
  try {
    const raw = localStorage.getItem(URI_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedStream[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUriCacheRows(rows: CachedStream[]): void {
  localStorage.setItem(URI_CACHE_KEY, JSON.stringify(rows.slice(0, URI_CACHE_MAX)));
}

export function resolutionQueryFromEnvelope(
  env: Pick<MediaEnvelope, 'envelopeId' | 'sourceId' | 'title' | 'artist' | 'album'>,
): string {
  return streamCacheKey(env);
}

export function getCachedStream(query: string): CachedStream | null {
  const q = query.trim();
  if (!q) return null;
  const now = Date.now();
  const rows = readUriCacheRows();
  const hit = rows.find((r) => r.query === q && r.expiresAt > now);
  if (!hit) {
    const pruned = rows.filter((r) => r.expiresAt > now);
    if (pruned.length !== rows.length) writeUriCacheRows(pruned);
    return null;
  }
  return hit;
}

/** Drop a stale URI cache row (e.g. missing on-disk yt-dlp file). */
export function removeCachedStream(query: string): void {
  const q = query.trim();
  if (!q) return;
  const rows = readUriCacheRows().filter((r) => r.query !== q);
  writeUriCacheRows(rows);
}

export function getCachedStreamForTrack(
  env: Pick<MediaEnvelope, 'envelopeId' | 'sourceId' | 'title' | 'artist' | 'album'>,
): CachedStream | null {
  return getCachedStream(resolutionQueryFromEnvelope(env));
}

export function putCachedStream(
  entry: Pick<CachedStream, 'query' | 'uri' | 'source'> & { expiresAt?: number },
): void {
  const now = Date.now();
  const full: CachedStream = {
    query: entry.query.trim(),
    uri: entry.uri.trim(),
    source: entry.source,
    resolvedAt: now,
    expiresAt: entry.expiresAt ?? now + MOBILE_RESOLUTION_CACHE_TTL_MS,
  };
  if (!full.query || !full.uri) return;
  const rows = readUriCacheRows().filter(
    (r) => r.query !== full.query && r.expiresAt > now,
  );
  rows.unshift(full);
  writeUriCacheRows(rows);
}

export function getUriCacheStats(): { count: number; validCount: number } {
  const now = Date.now();
  const rows = readUriCacheRows();
  return {
    count: rows.length,
    validCount: rows.filter((r) => r.expiresAt > now).length,
  };
}

export function clearUriResolutionCache(): void {
  localStorage.removeItem(URI_CACHE_KEY);
}

type StreamCacheRow = Omit<StreamCacheEntry, 'audioBlob'> & { audioBlob?: Blob };

const blobUrlByKey = new Map<string, string>();
let indexKeys = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeStreamCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function streamCacheKey(
  env: Pick<MediaEnvelope, 'envelopeId' | 'sourceId' | 'title' | 'artist' | 'album'>,
): string {
  const trackId = env.sourceId?.trim() || env.envelopeId?.trim();
  if (trackId && !trackId.startsWith('acquire-')) {
    const parts = [
      trackId,
      env.title?.trim().toLowerCase(),
      env.artist?.trim().toLowerCase(),
    ];
    if (env.album?.trim()) parts.push(env.album.trim().toLowerCase());
    return parts.filter(Boolean).join('|');
  }
  const parts = [
    env.title?.trim().toLowerCase(),
    env.artist?.trim().toLowerCase(),
    env.album?.trim().toLowerCase(),
  ].filter(Boolean);
  return parts.join('|') || env.envelopeId;
}

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function revokeBlobUrl(key: string): void {
  const url = blobUrlByKey.get(key);
  if (url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  blobUrlByKey.delete(key);
}

export function formatStreamCacheMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function streamCacheLimitBytes(): number {
  return loadStreamCacheLimitMb() * 1024 * 1024;
}

export function streamCacheUsagePercent(usedBytes: number): number {
  const limit = streamCacheLimitBytes();
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / limit) * 1000) / 10);
}

async function readAllRows(): Promise<StreamCacheRow[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as StreamCacheRow[]);
    req.onerror = () => reject(req.error);
  });
}

async function readRow(id: string): Promise<StreamCacheRow | null> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as StreamCacheRow | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function warmStreamCacheIndex(): Promise<void> {
  const rows = await readAllRows();
  const now = Date.now();
  indexKeys = new Set(
    rows.filter((r) => r.expiresAt > now).map((r) => r.id),
  );
  notify();
}

export function isEnvelopeStreamCached(
  env: Pick<MediaEnvelope, 'envelopeId' | 'sourceId' | 'title' | 'artist' | 'album'>,
): boolean {
  if (!loadStreamCacheEnabled()) return false;
  return indexKeys.has(streamCacheKey(env));
}

export async function getStreamCacheUsage(): Promise<StreamCacheUsage> {
  const rows = await readAllRows();
  let bytes = 0;
  for (const row of rows) {
    if (row.audioBlob instanceof Blob) bytes += row.audioBlob.size;
    else if (row.sizeBytes) bytes += row.sizeBytes;
  }
  return { bytes, trackCount: rows.length };
}

async function deleteRow(id: string): Promise<void> {
  revokeBlobUrl(id);
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  indexKeys.delete(id);
}

async function evictExpiredRows(): Promise<void> {
  const now = Date.now();
  const rows = await readAllRows();
  for (const row of rows) {
    if (row.expiresAt <= now) await deleteRow(row.id);
  }
}

async function evictLruUntilFits(projectedBytes: number): Promise<void> {
  const limit = streamCacheLimitBytes();
  if (projectedBytes <= limit) return;

  const rows = await readAllRows();
  const sorted = [...rows].sort(
    (a, b) => (a.lastPlayedAt ?? a.cachedAt) - (b.lastPlayedAt ?? b.cachedAt),
  );
  let bytes = rows.reduce((n, r) => n + (r.sizeBytes ?? r.audioBlob?.size ?? 0), 0);
  for (const row of sorted) {
    if (bytes + projectedBytes - (row.sizeBytes ?? row.audioBlob?.size ?? 0) <= limit) break;
    const rowBytes = row.sizeBytes ?? row.audioBlob?.size ?? 0;
    await deleteRow(row.id);
    bytes -= rowBytes;
  }
}

function envelopeFromCached(
  key: string,
  row: StreamCacheRow,
  url: string,
): MediaEnvelope {
  return {
    envelopeId: `stream-cache-${key}`,
    title: row.title,
    artist: row.artist,
    album: row.album,
    url,
    durationSeconds: row.durationSeconds ?? 0,
    provider: 'stream-cache',
    transport: 'element-src',
    sourceId: key,
    mimeType: row.mimeType,
    artworkUrl: row.artworkUrl,
  };
}

/** Resolve a cached blob URL for playback (updates lastPlayedAt). */
export async function getStreamCacheEnvelope(
  env: MediaEnvelope,
  options?: { skipEviction?: boolean },
): Promise<MediaEnvelope | null> {
  if (!loadStreamCacheEnabled()) return null;

  if (!options?.skipEviction) {
    await evictExpiredRows();
  }
  const key = streamCacheKey(env);
  const row = await readRow(key);
  if (!row?.audioBlob || !(row.audioBlob instanceof Blob)) return null;
  if (row.expiresAt <= Date.now()) {
    await deleteRow(key);
    return null;
  }

  let url = blobUrlByKey.get(key);
  if (!url) {
    url = URL.createObjectURL(row.audioBlob);
    blobUrlByKey.set(key, url);
  }

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const current = getReq.result as StreamCacheRow | undefined;
      if (current) store.put({ ...current, lastPlayedAt: Date.now() });
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return envelopeFromCached(key, row, url);
}

async function putStreamCacheEntry(
  entry: Omit<StreamCacheEntry, 'cachedAt' | 'lastPlayedAt' | 'expiresAt' | 'sizeBytes'> & {
    cachedAt?: number;
    lastPlayedAt?: number;
    expiresAt?: number;
    sizeBytes?: number;
  },
): Promise<void> {
  const now = Date.now();
  const sizeBytes = entry.sizeBytes ?? entry.audioBlob.size;
  const full: StreamCacheEntry = {
    ...entry,
    sizeBytes,
    cachedAt: entry.cachedAt ?? now,
    lastPlayedAt: entry.lastPlayedAt ?? now,
    expiresAt: entry.expiresAt ?? now + STREAM_CACHE_TTL_MS,
  };

  await evictExpiredRows();
  const rows = await readAllRows();
  const existing = rows.find((r) => r.id === full.id);
  const existingBytes = existing?.sizeBytes ?? existing?.audioBlob?.size ?? 0;
  const projected =
    rows.reduce((n, r) => n + (r.sizeBytes ?? r.audioBlob?.size ?? 0), 0) -
    existingBytes +
    sizeBytes;
  await evictLruUntilFits(projected);

  revokeBlobUrl(full.id);
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  indexKeys.add(full.id);
  notify();
}

/** Map a playable URL to a tier34 full-download endpoint when possible. */
export function buildFullStreamDownloadUrl(url: string, backendUrl?: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const base = (backendUrl ?? getTier34BaseUrl()).replace(/\/$/, '');

  const lockerBlob = trimmed.match(/\/api\/locker\/blob\/([a-f0-9]{64})/i);
  if (lockerBlob) {
    const out = trimmed.startsWith('http') ? trimmed : `${base}${trimmed}`;
    return appendSandboxClientQuery(out);
  }

  const castStream = trimmed.match(/\/api\/cast\/stream\/([^/?#]+)/i);
  if (castStream && base) {
    return appendSandboxClientQuery(
      `${base}/api/stream/${encodeURIComponent(castStream[1])}/full`,
    );
  }

  const streamFull = trimmed.match(/\/api\/stream\/([^/?#]+)\/full/i);
  if (streamFull) {
    const out = trimmed.startsWith('http') ? trimmed : `${base}${trimmed}`;
    return appendSandboxClientQuery(out);
  }

  if (trimmed.includes('/api/proxy/stream') && base) {
    try {
      const parsed = new URL(trimmed, base);
      const upstream = parsed.searchParams.get('url');
      if (upstream) {
        return appendSandboxClientQuery(
          `${base}/api/stream/full?url=${encodeURIComponent(upstream)}`,
        );
      }
    } catch {
      /* ignore */
    }
  }

  if (trimmed.startsWith('/api/') && base) return appendSandboxClientQuery(`${base}${trimmed}`);
  return appendSandboxClientQuery(trimmed);
}

export function aggressiveCacheMaxBytes(): number {
  return loadAggressiveCacheMaxMb() * 1024 * 1024;
}

async function probeRemoteContentLength(url: string): Promise<number | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const res = await fetchWithTimeout(trimmed, { method: 'HEAD' }, 12_000);
    if (!res.ok) return null;
    const cl = res.headers.get('content-length');
    if (!cl) return null;
    const n = parseInt(cl, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function fetchAudioBlobWithProgress(
  url: string,
  onProgress?: PrefetchProgressCallback,
): Promise<Blob> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('No stream URL');

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PREFETCH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      appendSandboxClientQuery(trimmed),
      sandboxStreamFetchInit({ signal: ctrl.signal }),
    );
    if (!res.ok) throw new Error(`Cache fetch failed (HTTP ${res.status})`);

    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? parseInt(totalHeader, 10) : 0;
    const hasTotal = Number.isFinite(total) && total > 0;

    if (!res.body) {
      const blob = await res.blob();
      onProgress?.(100, 'download');
      return blob;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      if (hasTotal) {
        onProgress?.(Math.min(99, Math.round((received / total) * 100)), 'download');
      } else if (received > 0) {
        onProgress?.(Math.min(90, Math.round(received / 50_000)), 'download');
      }
    }

    const blob = new Blob(chunks, {
      type: res.headers.get('content-type') ?? 'application/octet-stream',
    });
    if (blob.size < 8_000) throw new Error('Stream too small to cache');
    const blobType = blob.type || res.headers.get('content-type') || '';
    if (blobType.includes('text/html')) {
      throw new Error('Received HTML instead of audio');
    }
    onProgress?.(100, 'download');
    return blob;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchAudioBlob(url: string): Promise<Blob> {
  return fetchAudioBlobWithProgress(url);
}

function shouldCacheEnvelope(env: MediaEnvelope): boolean {
  if (!loadStreamCacheEnabled()) return false;
  if (
    env.provider === 'local-vault' ||
    env.provider === 'stream-cache' ||
    env.provider === 'indexeddb' ||
    env.provider === 'blob'
  ) {
    return false;
  }
  const url = env.url?.trim();
  if (!url || isCatalogPreviewUrl(url)) return false;
  if (
    env.provider === 'proxy' ||
    env.provider === 'stream-proxy' ||
    env.provider === 'debrid' ||
    env.transport === 'proxy' ||
    env.transport === 'stream-proxy' ||
    env.transport === 'debrid'
  ) {
    return true;
  }
  return !isCatalogPreviewUrl(url);
}

function isAlreadyLocalEnvelope(env: MediaEnvelope): boolean {
  return (
    env.provider === 'local-vault' ||
    env.provider === 'stream-cache' ||
    env.provider === 'indexeddb' ||
    env.provider === 'blob'
  );
}

async function prefetchTrackIntoStreamCacheCore(
  env: MediaEnvelope,
  options?: {
    onProgress?: PrefetchProgressCallback;
    candidates?: import('./sandboxLayer1').CandidateSource[];
    requireAggressiveFlag?: boolean;
  },
): Promise<AggressivePrefetchResult> {
  if (options?.requireAggressiveFlag && !loadAggressiveOfflineCacheEnabled()) {
    return { ok: false, reason: 'disabled' };
  }
  if (!loadStreamCacheEnabled()) {
    return { ok: false, reason: 'disabled' };
  }
  if (isAlreadyLocalEnvelope(env)) {
    return { ok: false, reason: 'local' };
  }

  const key = streamCacheKey(env);
  const cached = await getStreamCacheEnvelope(env);
  if (cached?.url?.trim()) {
    return { ok: true, envelope: cached, fromCache: true };
  }

  let resolved = env;
  const rawUrl = env.url?.trim() ?? '';
  if (!rawUrl || isCatalogPreviewUrl(rawUrl)) {
    const { executeTrack } = await import('./playbackPipeline');
    resolved = await executeTrack(env, options?.candidates);
  }

  if (!resolved.url?.trim()) {
    return { ok: false, reason: 'no_url' };
  }
  if (!shouldCacheEnvelope(resolved)) {
    return { ok: false, reason: 'local' };
  }

  const fullUrl = buildFullStreamDownloadUrl(resolved.url);
  const maxBytes = aggressiveCacheMaxBytes();

  options?.onProgress?.(0, 'probe');
  const contentLength = await probeRemoteContentLength(fullUrl);
  if (contentLength != null && contentLength > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }

  try {
    const blob = await fetchAudioBlobWithProgress(fullUrl, options?.onProgress);
    if (blob.size > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }

    await putStreamCacheEntry({
      id: key,
      title: resolved.title,
      artist: resolved.artist,
      album: resolved.album,
      audioBlob: blob,
      sourceTier: resolved.provider,
      mimeType: blob.type || resolved.mimeType,
      durationSeconds: resolved.durationSeconds,
      artworkUrl: resolved.artworkUrl,
    });

    const cachedEnvelope = await getStreamCacheEnvelope(resolved);
    if (cachedEnvelope?.url?.trim()) {
      return { ok: true, envelope: cachedEnvelope, fromCache: false };
    }
    return { ok: false, reason: 'fetch_failed' };
  } catch (err) {
    console.warn('[streamCache] prefetch failed:', err);
    return { ok: false, reason: 'fetch_failed' };
  }
}

/**
 * Download the entire track into IndexedDB before playback when aggressive cache is on.
 * Returns a blob-URL envelope or null to fall back to progressive streaming.
 */
export async function prefetchFullTrack(
  env: MediaEnvelope,
  options?: {
    onProgress?: PrefetchProgressCallback;
    candidates?: import('./sandboxLayer1').CandidateSource[];
  },
): Promise<AggressivePrefetchResult> {
  return prefetchTrackIntoStreamCacheCore(env, { ...options, requireAggressiveFlag: true });
}

/**
 * Silent background prefetch into stream cache (next-track / Wi‑Fi queue warm-up).
 * Does not require aggressive offline cache — respects size cap and TTL.
 */
export async function silentPrefetchTrackIntoStreamCache(
  env: MediaEnvelope,
  candidates?: import('./sandboxLayer1').CandidateSource[],
): Promise<AggressivePrefetchResult> {
  return prefetchTrackIntoStreamCacheCore(env, { candidates, requireAggressiveFlag: false });
}

/** Prefetch + progress toast; falls back to progressive URL on failure. */
export async function applyAggressivePrefetchIfEnabled(
  env: MediaEnvelope,
  candidates?: import('./sandboxLayer1').CandidateSource[],
  notify?: (detail: import('./prefetchProgressNotify').PrefetchProgressToastDetail) => void,
  dismiss?: (prefetchId: string) => void,
): Promise<MediaEnvelope> {
  if (!loadAggressiveOfflineCacheEnabled()) return env;

  const prefetchId = streamCacheKey(env);
  const baseDetail = {
    prefetchId,
    label: env.title,
    artist: env.artist,
    progress: 0,
    status: 'prefetching' as const,
    done: false,
  };

  notify?.(baseDetail);

  const result = await prefetchFullTrack(env, {
    candidates,
    onProgress: (progress) => {
      notify?.({ ...baseDetail, progress, status: 'prefetching', done: false });
    },
  });

  if (result.ok === true) {
    dismiss?.(prefetchId);
    return result.envelope;
  }

  if (result.ok === false) {
    if (result.reason === 'too_large' || result.reason === 'fetch_failed') {
      notify?.({
        ...baseDetail,
        progress: 0,
        status: 'fallback',
        done: true,
        error:
          result.reason === 'too_large'
            ? 'File exceeds prefetch size cap — streaming instead'
            : 'Prefetch failed — streaming instead',
      });
      window.setTimeout(() => dismiss?.(prefetchId), 4000);
    } else {
      dismiss?.(prefetchId);
    }
  }

  return env;
}

/** Background auto-cache after successful full-stream playback. */
export function storeStreamCacheAfterPlay(env: MediaEnvelope): void {
  if (loadAggressiveOfflineCacheEnabled()) return;
  if (!shouldCacheEnvelope(env)) return;
  const key = streamCacheKey(env);
  if (indexKeys.has(key)) return;

  void (async () => {
    try {
      if (await readRow(key)) return;
      const blob = await fetchAudioBlob(env.url);
      await putStreamCacheEntry({
        id: key,
        title: env.title,
        artist: env.artist,
        album: env.album,
        audioBlob: blob,
        sourceTier: env.provider,
        mimeType: blob.type || env.mimeType,
        durationSeconds: env.durationSeconds,
        artworkUrl: env.artworkUrl,
      });
    } catch (err) {
      console.warn('[streamCache] auto-cache failed:', err);
    }
  })();
}

/** Manual "Cache for offline" — fetch and store without Locker metadata. */
export async function cacheEnvelopeForOffline(
  env: MediaEnvelope,
  candidates?: import('./sandboxLayer1').CandidateSource[],
): Promise<void> {
  if (!loadStreamCacheEnabled()) {
    throw new Error('Stream cache is disabled in Settings');
  }

  const key = streamCacheKey(env);
  if (indexKeys.has(key) || (await readRow(key))) return;

  const { executeTrack } = await import('./playbackPipeline');
  const resolved = await executeTrack(env, candidates);
  if (!shouldCacheEnvelope(resolved)) {
    throw new Error('No full-length stream available to cache');
  }

  const blob = await fetchAudioBlob(resolved.url);
  await putStreamCacheEntry({
    id: key,
    title: resolved.title,
    artist: resolved.artist,
    album: resolved.album,
    audioBlob: blob,
    sourceTier: resolved.provider,
    mimeType: blob.type || resolved.mimeType,
    durationSeconds: resolved.durationSeconds,
    artworkUrl: resolved.artworkUrl,
  });
}

export async function removeEnvelopeFromStreamCache(
  env: Pick<MediaEnvelope, 'envelopeId' | 'sourceId' | 'title' | 'artist' | 'album'>,
): Promise<boolean> {
  const key = streamCacheKey(env);
  const row = await readRow(key);
  if (!row) return false;
  await deleteRow(key);
  notify();
  return true;
}

export async function clearStreamCache(): Promise<void> {
  for (const key of [...blobUrlByKey.keys()]) revokeBlobUrl(key);
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  indexKeys = new Set();
  notify();
}
