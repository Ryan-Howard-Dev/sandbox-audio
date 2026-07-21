import type { MediaEnvelope } from './sandboxLayer1';
import {
  hasPlayablePodcastStreamUrl,
  resolvePodcastEnvelopeForPlayback,
} from './podcastPlayback';

/** Catalog audiobooks stream like podcasts (HTTPS + optional Tier34 proxy + stream cache). */
export function hasPlayableAudiobookCatalogStreamUrl(env: MediaEnvelope): boolean {
  return hasPlayablePodcastStreamUrl(env);
}

export async function resolveAudiobookCatalogEnvelopeForPlayback(
  env: MediaEnvelope,
  options?: { skipCacheEviction?: boolean },
): Promise<MediaEnvelope> {
  return resolvePodcastEnvelopeForPlayback(env, options);
}
