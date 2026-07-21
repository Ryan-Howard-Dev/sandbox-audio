import type { MediaEnvelope } from './sandboxLayer1';
import { isCapacitorNative } from './platformEnv';
import { Capacitor } from '@capacitor/core';
import { NativeExoPlayback } from './androidNativePlayback';
import { podcastPlaybackUrl, unwrapPodcastEnclosureUrl } from './podcastRss';
import { getStreamCacheEnvelope } from './streamCache';
import { getTier34BaseUrl, isTier34ReachableCached } from './tier34/client';

/** Extract the original enclosure URL from a Sandbox proxy wrapper. */
export function unwrapPodcastProxyUrl(url: string): string {
  return unwrapPodcastEnclosureUrl(url);
}

export class PodcastPlaybackError extends Error {
  constructor(
    message: string,
    readonly code: 'missing-url' | 'invalid-url' | 'youtube-offline' = 'invalid-url',
  ) {
    super(message);
    this.name = 'PodcastPlaybackError';
  }
}

/** True when an envelope has a resolvable podcast stream (direct HTTPS, blob, or cache). */
export function hasPlayablePodcastStreamUrl(env: MediaEnvelope): boolean {
  const raw = env.url?.trim() ?? '';
  if (!raw) return false;
  if (raw.startsWith('blob:')) return true;
  const enclosure = unwrapPodcastEnclosureUrl(raw);
  return /^https?:\/\//i.test(enclosure);
}

/** Pick a stream URL that plays on-device without a dead Sandbox Server proxy. */
export function resolvePlayablePodcastStreamUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  const isProxy =
    trimmed.includes('/api/proxy/stream') || trimmed.includes('/api/podcast-audio-proxy');
  const enclosure = isProxy ? unwrapPodcastProxyUrl(trimmed) : trimmed;

  if (isProxy && !isTier34ReachableCached() && /^https?:\/\//i.test(enclosure)) {
    return enclosure;
  }

  try {
    return podcastPlaybackUrl(enclosure);
  } catch (err) {
    if (/^https?:\/\//i.test(enclosure)) return enclosure;
    throw err;
  }
}

/**
 * CORS-safe stream URL for podcast Web Audio (Smart Speed / Voice Boost).
 * Direct HTTPS enclosures are silent through createMediaElementSource without CORS headers.
 */
export async function resolvePodcastWebAudioStreamUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  const enclosure = unwrapPodcastProxyUrl(trimmed);
  if (trimmed.startsWith('blob:')) return trimmed;

  const tier34 = getTier34BaseUrl()?.replace(/\/$/, '') ?? '';
  if (tier34 && isTier34ReachableCached()) {
    return `${tier34}/api/proxy/stream?url=${encodeURIComponent(enclosure)}`;
  }

  if (isCapacitorNative() && Capacitor.getPlatform() === 'android') {
    try {
      const { url } = await NativeExoPlayback.localStreamProxyUrl({ url: enclosure });
      if (url?.startsWith('http')) return url;
    } catch (err) {
      console.warn('[podcastPlayback] Android local stream proxy failed:', err);
    }
  }

  if (typeof window !== 'undefined' && !isCapacitorNative()) {
    return `${window.location.origin}/api/podcast-audio-proxy?url=${encodeURIComponent(enclosure)}`;
  }

  if (/^https?:\/\//i.test(enclosure)) return enclosure;
  return enclosure;
}

export function ensureAbsolutePodcastStreamUrl(url: string): string {
  let trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('/api/') && typeof window !== 'undefined') {
    trimmed = `${window.location.origin}${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('blob:')) {
    return resolvePlayablePodcastStreamUrl(trimmed);
  }
  return resolvePlayablePodcastStreamUrl(trimmed);
}

/** Prefer offline cache; ensure ExoPlayer gets an absolute stream URL on mobile. */
export async function resolvePodcastEnvelopeForPlayback(
  env: MediaEnvelope,
  options?: { skipCacheEviction?: boolean },
): Promise<MediaEnvelope> {
  const cached = await getStreamCacheEnvelope(env, {
    skipEviction: options?.skipCacheEviction,
  });
  if (cached?.url?.trim()) {
    const cachedUrl = ensureAbsolutePodcastStreamUrl(cached.url);
    return {
      ...env,
      ...cached,
      url: cachedUrl,
      envelopeId: env.envelopeId,
      title: env.title,
      artist: env.artist,
      album: env.album ?? env.artist,
      artworkUrl: env.artworkUrl ?? cached.artworkUrl,
    };
  }

  const url = env.url?.trim();
  if (!url) {
    throw new PodcastPlaybackError(
      'No audio URL for this episode — refresh the podcast feed and try again',
      'missing-url',
    );
  }
  let absolute: string;
  try {
    absolute = ensureAbsolutePodcastStreamUrl(url);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Could not resolve podcast stream URL';
    throw new PodcastPlaybackError(
      msg.includes('Sandbox Server')
        ? `${msg} — or refresh the feed while online`
        : `${msg} — refresh the podcast feed and try again`,
      'invalid-url',
    );
  }
  if (!absolute.startsWith('http') && !absolute.startsWith('blob:')) {
    throw new PodcastPlaybackError(
      'Podcast playback needs a direct stream URL or Sandbox Server — refresh the feed or check Settings → Addons',
      'invalid-url',
    );
  }
  if (
    isCapacitorNative() &&
    (absolute.includes('localhost') || absolute.includes('127.0.0.1')) &&
    absolute.includes('/api/')
  ) {
    const direct = unwrapPodcastEnclosureUrl(absolute);
    if (/^https?:\/\//i.test(direct) && !direct.includes('localhost')) {
      absolute = direct;
    } else {
      throw new PodcastPlaybackError(
        'Stored episode URL is invalid on this device — refresh the podcast feed',
        'invalid-url',
      );
    }
  }
  return { ...env, url: absolute };
}
