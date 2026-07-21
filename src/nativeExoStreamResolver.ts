/**
 * Resolve locker blob / local-vault URLs to ExoPlayer stream URIs (HTTP or content://).
 */

import { Capacitor } from '@capacitor/core';
import type { MediaEnvelope } from './sandboxLayer1';
import { NativeExoPlayback } from './androidNativePlayback';
import {
  isNativeExoPlayableUrl,
  registerLockerBlobContentUri,
} from './nativeExoLockerBridge';
import {
  appendSandboxClientQuery,
  getTier34BaseUrl,
  isServerReachableCached,
} from './tier34/client';

/** Local device URI from yt-dlp / locker — instant replay without re-resolve. */
export function isLocalDevicePlayUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  return /^file:\/\//i.test(trimmed) || /^content:\/\//i.test(trimmed);
}

/** True when a cached file:// play URL still exists on device (Android yt-dlp cache). */
export async function localDevicePlayUrlReachable(url: string): Promise<boolean> {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return false;
  if (/^content:\/\//i.test(trimmed)) return true;
  if (!/^file:\/\//i.test(trimmed)) return true;
  if (Capacitor.getPlatform() !== 'android') return true;
  try {
    const probe = await NativeExoPlayback.probeLocalFile({ path: trimmed });
    return Boolean(probe?.exists);
  } catch {
    return false;
  }
}

/** True when a resolved stream URL cannot play without Sandbox Server (stale CDN / tier34 proxy). */
export function isOfflineUnplayableStreamUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return true;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  const serverOnline = Boolean(base) && isServerReachableCached();
  if (serverOnline) return false;
  if (trimmed.includes('/api/proxy/stream') || trimmed.startsWith('/api/')) return true;
  if (base && trimmed.startsWith(base)) return true;
  if (/googlevideo\.com/i.test(trimmed)) return true;
  return false;
}

/** Route YouTube CDN URLs through Sandbox Server proxy when configured (avoids 403 in ExoPlayer). */
export function wrapGoogleStreamForExo(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('/api/proxy/stream')) return appendSandboxClientQuery(trimmed);
  const needsProxy = /googlevideo\.com|youtube\.com\/|youtu\.be\//i.test(trimmed);
  if (!needsProxy) return trimmed;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base || !isServerReachableCached()) return trimmed;
  return appendSandboxClientQuery(
    `${base}/api/proxy/stream?url=${encodeURIComponent(trimmed)}`,
  );
}

function isYoutubeWatchUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

/** Log when a resolved URL looks like a catalog preview or truncated stream. */
export function logSuspectPlaybackUrl(
  url: string,
  context: string,
  expectedDurationSecs?: number,
): void {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return;
  if (/audio-ssl\.itunes|preview/i.test(trimmed)) {
    console.warn(`[playback] PREVIEW URL (${context}):`, trimmed.slice(0, 120));
    return;
  }
  if (/storyboard|sb\.googlevideo|clip/i.test(trimmed)) {
    console.warn(`[playback] suspect clip/storyboard URL (${context}):`, trimmed.slice(0, 120));
  }
  if (expectedDurationSecs != null && expectedDurationSecs > 90 && /^file:\/\//i.test(trimmed)) {
    console.log(
      `[playback] local file for long track (${context}) expectedDur=${expectedDurationSecs}s`,
    );
  }
}

/**
 * Pick the ExoPlayer URL for a mobile yt-dlp hit (sync — prefer pickMobileExoPlayUrlAsync offline).
 */
export function pickMobileExoPlayUrl(resolved: {
  uri: string;
  watchUrl?: string;
}): string {
  const uri = resolved.uri?.trim() ?? '';
  const watch = resolved.watchUrl?.trim();
  const base = getTier34BaseUrl().replace(/\/$/, '');
  const serverOnline = Boolean(base) && isServerReachableCached();

  if (/^file:\/\//i.test(uri) || /^content:\/\//i.test(uri)) {
    return uri;
  }

  if (/^https?:\/\//i.test(uri) && !isYoutubeWatchUrl(uri)) {
    if (/googlevideo\.com/i.test(uri)) {
      logSuspectPlaybackUrl(uri, serverOnline ? 'mobile-stream-server' : 'mobile-stream-offline');
      return serverOnline ? wrapGoogleStreamForExo(uri) : uri;
    }
    return wrapGoogleStreamForExo(uri);
  }

  if (uri && isYoutubeWatchUrl(uri)) {
    logSuspectPlaybackUrl(uri, 'mobile-watch-uri-fallback');
    return serverOnline ? wrapGoogleStreamForExo(uri) : uri;
  }

  if (serverOnline && watch && isYoutubeWatchUrl(watch)) {
    return wrapGoogleStreamForExo(watch);
  }

  if (watch && isYoutubeWatchUrl(watch)) {
    logSuspectPlaybackUrl(watch, 'mobile-watch-offline-last-resort');
    return watch;
  }

  return wrapGoogleStreamForExo(uri || watch || '');
}

/**
 * Pick the ExoPlayer URL for a mobile yt-dlp hit (async — may use Piped when server offline).
 */
export async function pickMobileExoPlayUrlAsync(resolved: {
  uri: string;
  watchUrl?: string;
}): Promise<string> {
  return pickMobileExoPlayUrl(resolved);
}

const LOCAL_PROVIDERS = new Set(['local-vault', 'indexeddb', 'blob', 'stream-cache']);
const HASH_RE = /^[a-f0-9]{64}$/i;

function lanBase(): string {
  return getTier34BaseUrl().replace(/\/$/, '');
}

export function needsNativeStreamResolution(url: string, provider?: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return false;
  if (trimmed.startsWith('blob:')) return true;
  if (provider && LOCAL_PROVIDERS.has(provider)) return true;
  return false;
}

function blobStreamUrl(contentHash: string): string | null {
  const base = lanBase();
  if (!base) return null;
  return appendSandboxClientQuery(`${base}/api/locker/blob/${contentHash}`);
}

function castStreamUrl(trackKey: string): string | null {
  const base = lanBase();
  if (!base) return null;
  return appendSandboxClientQuery(
    `${base}/api/cast/stream/${encodeURIComponent(trackKey)}`,
  );
}

/**
 * Map a playable envelope to tier34 HTTP when LAN server is configured.
 * Returns the original URL when already HTTP(S), or null when unresolved.
 */
export function resolveNativeExoStreamUrl(envelope: MediaEnvelope): string | null {
  const rawUrl = envelope.url?.trim() ?? '';
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return wrapGoogleStreamForExo(rawUrl);
  if (/^content:\/\//i.test(rawUrl)) return rawUrl;

  if (!needsNativeStreamResolution(rawUrl, envelope.provider)) return null;

  if (envelope.sourceId) {
    return castStreamUrl(envelope.sourceId);
  }

  const fromId = envelope.envelopeId?.replace(/^local-/, '') ?? '';
  if (HASH_RE.test(fromId)) {
    return blobStreamUrl(fromId.toLowerCase());
  }

  if (envelope.envelopeId) {
    return castStreamUrl(envelope.envelopeId.replace(/^local-/, ''));
  }

  return null;
}

/**
 * Resolve envelope to an ExoPlayer URI — offline locker blobs use content:// first.
 */
export async function resolveNativeExoStreamUrlAsync(
  envelope: MediaEnvelope,
): Promise<string | null> {
  const rawUrl = envelope.url?.trim() ?? '';
  if (!rawUrl) return null;
  if (/^file:\/\//i.test(rawUrl)) return rawUrl;
  if (isNativeExoPlayableUrl(rawUrl)) return wrapGoogleStreamForExo(rawUrl);

  if (
    Capacitor.getPlatform() === 'android' &&
    needsNativeStreamResolution(rawUrl, envelope.provider)
  ) {
    const contentUri = await registerLockerBlobContentUri(envelope);
    if (contentUri) return contentUri;
  }

  return resolveNativeExoStreamUrl(envelope);
}

/** @deprecated Use needsNativeStreamResolution */
export const needsHttpResolution = needsNativeStreamResolution;
