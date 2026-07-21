/**
 * Auto similar-track radio when a standalone (non-album) track starts playing.
 * Builds a multi-track queue + MixRadioSession, and persists the system "Track radio" playlist.
 */

import type { MediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { CatalogTrack } from '../searchCatalog';
import { isPodcastEnvelopeId } from '../podcastStorage';
import {
  buildLockerShuffleRadio,
  buildTrackRadio,
  type MixRadioSession,
} from '../playerMixRadio';
import { upsertTrackRadioPlaylist } from '../radioSessionPlaylist';
import { buildAlbumPlayQueueEnvelopes } from './albumPlayQueue';
import {
  countDistinctQueueEnvelopeIds,
  dedupeConsecutiveQueueEnvelopes,
  repeatAllAllowedForQueue,
} from './radioQueueDedupe';

export type StandaloneSimilarRadioContext = {
  envelope: MediaEnvelope;
  playQueue: MediaEnvelope[];
  albumTracks?: CatalogTrack[];
  searchHits: ResolvedSearchHit[];
  albumTitle?: string;
  expectedTrackCount?: number;
  seedSearchQueue?: boolean;
  seamlessQueueAdvance?: boolean;
  /**
   * Only block when already mid-radio with a multi-track queue that includes this seed.
   * A stale mixRadioSession alone must not prevent a new single from building a playlist.
   */
  hasMixRadioSession?: boolean;
};

export function shouldAutoStartSimilarRadio(ctx: StandaloneSimilarRadioContext): boolean {
  if (ctx.seamlessQueueAdvance) return false;
  if (isPodcastEnvelopeId(ctx.envelope.envelopeId)) return false;

  // Explicit single/seed play always builds radio — ignore stale album-drill listings.
  if (!ctx.seedSearchQueue && ctx.albumTracks && ctx.albumTracks.length > 1) {
    const albumQueue = buildAlbumPlayQueueEnvelopes(
      ctx.searchHits,
      ctx.albumTracks,
      ctx.albumTitle,
      ctx.expectedTrackCount,
    );
    if (
      albumQueue.length > 1 &&
      albumQueue.some((track) => track.envelopeId === ctx.envelope.envelopeId)
    ) {
      return false;
    }
  }

  if (
    ctx.hasMixRadioSession &&
    ctx.playQueue.length > 1 &&
    ctx.playQueue.some((track) => track.envelopeId === ctx.envelope.envelopeId)
  ) {
    return false;
  }

  if (!ctx.seedSearchQueue && ctx.playQueue.length > 1) {
    const idx = ctx.playQueue.findIndex((track) => track.envelopeId === ctx.envelope.envelopeId);
    if (idx >= 0) return false;
  }

  return true;
}

export function mergeSimilarRadioIntoQueue(
  current: MediaEnvelope,
  similarTracks: MediaEnvelope[],
): { queue: MediaEnvelope[]; index: number } {
  const merged = similarTracks.length > 0 ? similarTracks : [current];
  const queue = dedupeConsecutiveQueueEnvelopes(merged);
  const index = queue.findIndex((track) => track.envelopeId === current.envelopeId);
  return { queue, index: index >= 0 ? index : 0 };
}

export type AutoSimilarRadioCallbacks = {
  setPlayQueue: (queue: MediaEnvelope[]) => void;
  setQueueIndex: (index: number) => void;
  setMixRadioSession: (session: MixRadioSession) => void;
  setRepeatMode: (mode: 'none' | 'one' | 'all') => void;
  setShuffleOn: (on: boolean) => void;
  isStillCurrent: () => boolean;
  labelFor: (key: 'unknownTitle' | 'unknownArtist') => string;
  /** Persist the radio queue as the system Track radio playlist (Playlists tab). */
  persistRadioPlaylist?: boolean;
};

export type AutoSimilarRadioResult =
  | { started: false }
  | { started: true; queue: MediaEnvelope[]; index: number };

/** Build and apply a taste-scored similar queue without interrupting the current track. */
export async function startAutoSimilarRadioIfNeeded(
  ctx: StandaloneSimilarRadioContext,
  callbacks: AutoSimilarRadioCallbacks,
): Promise<AutoSimilarRadioResult> {
  if (!shouldAutoStartSimilarRadio(ctx)) return { started: false };

  let tracks = (await buildTrackRadio(ctx.envelope)).filter((t) => Boolean(t.url?.trim()));
  if (tracks.length <= 1) {
    tracks = buildLockerShuffleRadio(ctx.envelope);
  }
  if (tracks.length <= 1) return { started: false };
  if (!callbacks.isStillCurrent()) return { started: false };

  const seedTitle = ctx.envelope.title?.trim() || callbacks.labelFor('unknownTitle');
  const seedArtist = ctx.envelope.artist?.trim() || callbacks.labelFor('unknownArtist');
  const { queue, index } = mergeSimilarRadioIntoQueue(ctx.envelope, tracks);
  if (countDistinctQueueEnvelopeIds(queue) <= 1) return { started: false };
  if (!callbacks.isStillCurrent()) return { started: false };

  callbacks.setPlayQueue(queue);
  callbacks.setQueueIndex(index);
  callbacks.setRepeatMode(repeatAllAllowedForQueue(queue) ? 'all' : 'none');
  callbacks.setShuffleOn(false);
  callbacks.setMixRadioSession({
    kind: 'radio',
    seedTitle,
    seedArtist,
  });
  if (callbacks.persistRadioPlaylist !== false) {
    upsertTrackRadioPlaylist(queue, { title: seedTitle, artist: seedArtist });
  }
  return { started: true, queue, index };
}
