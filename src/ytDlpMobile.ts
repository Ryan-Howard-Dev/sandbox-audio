/**
 * Android yt-dlp bridge — on-device stream extraction via native plugin.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface YtDlpMobileResolveResult {
  uri: string;
  watchUrl?: string;
  bitrate: number;
  format: string;
}

export interface YtDlpMobileSearchHit {
  id: string;
  title: string;
  artist: string;
  watchUrl: string;
  durationSeconds?: number;
}

export interface YtDlpMobileStatus {
  available: boolean;
  initialized: boolean;
  version?: string;
  error?: string;
}

export interface YtDlpMobilePlugin {
  getStatus(): Promise<YtDlpMobileStatus>;
  resolve(options: { query: string }): Promise<YtDlpMobileResolveResult>;
  downloadAudio(options: { query: string }): Promise<YtDlpMobileResolveResult>;
  search(options: { query: string; limit?: number }): Promise<{ results: YtDlpMobileSearchHit[] }>;
  cancel(): Promise<void>;
}

const YtDlpMobile = registerPlugin<YtDlpMobilePlugin>('YtDlpMobile', {
  web: () => import('./ytDlpMobile.web').then((m) => new m.YtDlpMobileWeb()),
});

export function isYtDlpMobileNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getYtDlpMobileStatus(): Promise<YtDlpMobileStatus> {
  if (!isYtDlpMobileNativeAvailable()) {
    return { available: false, initialized: false };
  }
  try {
    return await YtDlpMobile.getStatus();
  } catch {
    return { available: false, initialized: false };
  }
}

let lastYtDlpMobileError: string | null = null;
let resolveGeneration = 0;
/** One native resolve at a time — parallel prefetch must not cancel the active play resolve. */
let resolveChain: Promise<unknown> = Promise.resolve();

function enqueueYtDlpResolve<T>(fn: () => Promise<T>): Promise<T> {
  const run = resolveChain.then(fn, fn);
  resolveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getLastYtDlpMobileError(): string | null {
  return lastYtDlpMobileError;
}

/** Cancel in-flight native yt-dlp resolve (new play tap). */
export async function cancelYtDlpMobileResolve(): Promise<void> {
  resolveGeneration += 1;
  if (!isYtDlpMobileNativeAvailable()) return;
  try {
    await YtDlpMobile.cancel();
  } catch {
    /* plugin may be busy */
  }
}

/** Start a new yt-dlp resolve generation without calling native cancel (same-tap resolve). */
export function beginYtDlpResolveGeneration(): number {
  resolveGeneration += 1;
  return resolveGeneration;
}

function isResolveGenerationCurrent(generation: number): boolean {
  return generation === resolveGeneration;
}

const DEFAULT_YTDLP_INIT_TIMEOUT_MS = 45_000;
/** Match native RESOLVE_TIMEOUT_MS — resolve downloads full audio for YouTube watch URLs. */
const DEFAULT_YTDLP_RESOLVE_TIMEOUT_MS = 600_000;
const DEFAULT_YTDLP_DOWNLOAD_TIMEOUT_MS = 600_000;

/** Poll native yt-dlp init — safe to call before first on-device resolve. */
export async function waitForYtDlpInit(
  timeoutMs = DEFAULT_YTDLP_INIT_TIMEOUT_MS,
): Promise<boolean> {
  if (!isYtDlpMobileNativeAvailable()) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getYtDlpMobileStatus();
    if (status.initialized) return true;
    if (status.error) return false;
    await new Promise((r) => window.setTimeout(r, 200));
  }
  return (await getYtDlpMobileStatus()).initialized;
}

async function resolveViaYtDlpMobileOnce(
  q: string,
  generation: number,
): Promise<{ uri: string; watchUrl?: string; bitrate: number; format: string } | null> {
  if (!isResolveGenerationCurrent(generation)) return null;
  try {
    const result = await Promise.race([
      YtDlpMobile.resolve({ query: q }),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error('yt-dlp resolve timed out — check mobile data or Wi‑Fi')),
          DEFAULT_YTDLP_RESOLVE_TIMEOUT_MS,
        );
      }),
    ]);
    if (!isResolveGenerationCurrent(generation)) return null;
    const uri = result?.uri?.trim();
    if (!uri) {
      lastYtDlpMobileError = 'no stream found';
      return null;
    }
    const watchUrl = result?.watchUrl?.trim() || undefined;
    console.log('[YtDlpMobile] resolve ok', {
      query: q,
      format: typeof result.format === 'string' ? result.format : 'unknown',
      transport: 'MOBILE',
      hasWatchUrl: Boolean(watchUrl),
    });
    return {
      uri,
      watchUrl,
      bitrate: typeof result.bitrate === 'number' ? result.bitrate : 0,
      format: typeof result.format === 'string' ? result.format : 'unknown',
    };
  } catch (err) {
    if (!isResolveGenerationCurrent(generation)) return null;
    lastYtDlpMobileError = err instanceof Error ? err.message : String(err);
    console.warn('[YtDlpMobile] resolve failed:', lastYtDlpMobileError);
    return null;
  }
}

export async function resolveViaYtDlpMobile(
  query: string,
): Promise<{ uri: string; watchUrl?: string; bitrate: number; format: string } | null> {
  const q = query.trim();
  if (!q || !isYtDlpMobileNativeAvailable()) return null;

  return enqueueYtDlpResolve(async () => {
    const generation = resolveGeneration;
    lastYtDlpMobileError = null;

    let hit = await resolveViaYtDlpMobileOnce(q, generation);
    if (hit || !isResolveGenerationCurrent(generation)) return hit;

    const err = lastYtDlpMobileError?.toLowerCase() ?? '';
    if (err.includes('no stream found')) {
      await new Promise((r) => setTimeout(r, 350));
      if (!isResolveGenerationCurrent(generation)) return null;
      lastYtDlpMobileError = null;
      hit = await resolveViaYtDlpMobileOnce(q, generation);
    }
    return hit;
  });
}

/** Full audio download to device cache — longer timeout than stream resolve (locker acquisition). */
export async function downloadViaYtDlpMobile(
  query: string,
): Promise<{ uri: string; watchUrl?: string; bitrate: number; format: string } | null> {
  const q = query.trim();
  if (!q || !isYtDlpMobileNativeAvailable()) return null;
  lastYtDlpMobileError = null;
  try {
    const result = await Promise.race([
      YtDlpMobile.downloadAudio({ query: q }),
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error('yt-dlp download timed out')),
          DEFAULT_YTDLP_DOWNLOAD_TIMEOUT_MS,
        );
      }),
    ]);
    const uri = result?.uri?.trim();
    if (!uri) {
      lastYtDlpMobileError = 'download failed';
      return null;
    }
    console.log('[YtDlpMobile] download ok', { query: q, format: result.format ?? 'unknown' });
    return {
      uri,
      watchUrl: result.watchUrl?.trim() || undefined,
      bitrate: typeof result.bitrate === 'number' ? result.bitrate : 0,
      format: typeof result.format === 'string' ? result.format : 'unknown',
    };
  } catch (err) {
    lastYtDlpMobileError = err instanceof Error ? err.message : String(err);
    console.warn('[YtDlpMobile] download failed:', lastYtDlpMobileError);
    return null;
  }
}

const DEFAULT_YTDLP_SEARCH_TIMEOUT_MS = 22_000;

/** Lightweight ytsearch metadata for catalog supplement (no full download). */
export async function searchViaYtDlpMobile(
  query: string,
  limit = 8,
): Promise<YtDlpMobileSearchHit[]> {
  const q = query.trim();
  if (!q || !isYtDlpMobileNativeAvailable()) return [];
  try {
    const ready = await waitForYtDlpInit(25_000);
    if (!ready) return [];
    const result = await Promise.race([
      YtDlpMobile.search({ query: q, limit }),
      new Promise<{ results: YtDlpMobileSearchHit[] }>((resolve) => {
        window.setTimeout(() => resolve({ results: [] }), DEFAULT_YTDLP_SEARCH_TIMEOUT_MS);
      }),
    ]);
    const hits = Array.isArray(result.results) ? result.results : [];
    if (hits.length > 0) {
      console.log('[YtDlpMobile] search ok', { query: q, count: hits.length });
    }
    return hits;
  } catch (err) {
    console.warn('[YtDlpMobile] search failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
