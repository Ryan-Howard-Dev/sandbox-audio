import type { MediaEnvelope } from '../sandboxLayer1';
import { resolveNativeExoStreamUrlAsync } from '../nativeExoStreamResolver';
import type { NativeExoPlaybackEvent } from '../androidNativePlayback';

function urlsEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a.replace(/\/$/, '') === b.replace(/\/$/, '');
  }
}

/** Match a native Exo queue URL to a play-queue index (resolves locker blobs when needed). */
export async function findQueueIndexForExoUrl(
  queue: MediaEnvelope[],
  exoUrl: string,
): Promise<number> {
  const target = exoUrl.trim();
  if (!target || queue.length === 0) return -1;

  for (let i = 0; i < queue.length; i++) {
    const raw = queue[i]?.url?.trim() ?? '';
    if (urlsEquivalent(raw, target)) return i;
  }

  for (let i = 0; i < queue.length; i++) {
    const track = queue[i];
    if (!track) continue;
    const resolved = await resolveNativeExoStreamUrlAsync(track);
    if (resolved && urlsEquivalent(resolved, target)) return i;
  }

  return -1;
}

/**
 * Native stamps each MediaItem with `env:<envelopeId>` (or `url:<url>` when the track was
 * queued without a stable id). Reading the envelopeId back out of the mediaId matches a
 * transition exactly, with none of the URL-rewriting fragility of `findQueueIndexForExoUrl`.
 */
export function envelopeIdFromExoMediaId(mediaId?: string): string | null {
  const trimmed = mediaId?.trim() ?? '';
  if (!trimmed.startsWith('env:')) return null;
  const id = trimmed.slice(4).trim();
  return id || null;
}

/** Resolve a native transition to a queue index — stable mediaId first, URL as fallback. */
export async function findQueueIndexForExoTransition(
  queue: MediaEnvelope[],
  event: { mediaId?: string; url?: string },
): Promise<number> {
  const envelopeId = envelopeIdFromExoMediaId(event.mediaId);
  if (envelopeId) {
    const idx = queue.findIndex((track) => track?.envelopeId === envelopeId);
    if (idx >= 0) return idx;
  }
  return findQueueIndexForExoUrl(queue, event.url ?? '');
}

export function isExoMediaItemTransitionEvent(
  detail: unknown,
): detail is NativeExoPlaybackEvent & { url: string } {
  if (!detail || typeof detail !== 'object') return false;
  const evt = detail as NativeExoPlaybackEvent;
  return evt.event === 'mediaItemTransition' && typeof evt.url === 'string' && evt.url.trim().length > 0;
}
