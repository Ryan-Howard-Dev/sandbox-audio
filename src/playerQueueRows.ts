/**
 * Row model for the queue sheet on the player.
 *
 * The queue drawer splits the queue into "now / recently played / up next" sections, which is why
 * it hands its rows a position relative to up-next. The sheet shows one continuous list instead, so
 * every row carries its absolute index — remove, reorder and jump-to-track all address the queue by
 * position, and a relative index would silently target the wrong track the moment the queue is not
 * sitting at its head.
 *
 * queueIndex can lag the audio engine (a podcast tap plays without re-seeding the music queue), so
 * the playing row is found by envelope id first and only falls back to the index.
 */

import type { MediaEnvelope } from './sandboxLayer1';

export interface PlayerQueueRow {
  envelope: MediaEnvelope;
  index: number;
  current: boolean;
}

export function resolvePlayerQueueCurrentIndex(
  playQueue: MediaEnvelope[],
  queueIndex: number,
  activeEnvelope?: MediaEnvelope | null,
): number {
  const activeId = activeEnvelope?.envelopeId?.trim() ?? '';
  if (activeId) {
    const byId = playQueue.findIndex((env) => env?.envelopeId === activeId);
    if (byId >= 0) return byId;
    // The engine is playing something the queue does not contain — no row should claim to be it.
    return -1;
  }
  if (queueIndex >= 0 && queueIndex < playQueue.length) return queueIndex;
  return -1;
}

export function buildPlayerQueueRows(
  playQueue: MediaEnvelope[],
  queueIndex: number,
  activeEnvelope?: MediaEnvelope | null,
): PlayerQueueRow[] {
  const currentIndex = resolvePlayerQueueCurrentIndex(playQueue, queueIndex, activeEnvelope);
  return playQueue.map((envelope, index) => ({
    envelope,
    index,
    current: index === currentIndex,
  }));
}
