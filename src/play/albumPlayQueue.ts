import type { MediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { CatalogTrack } from '../searchCatalog';
import { buildAlbumRenderRows } from '../stations/SearchResultsView';

export type PlayQueueSeed = {
  queue: MediaEnvelope[];
  index: number;
};

/** Skip placeholder rows when seeding gapless/up-next from album drill. */
function isSeededQueueEnvelope(env: MediaEnvelope): boolean {
  return Boolean(env.envelopeId?.trim() && env.url?.trim());
}

/** Album tracklist order — matches buildAlbumRenderRows row order, not raw search hit order. */
export function buildAlbumPlayQueueEnvelopes(
  displayHits: ResolvedSearchHit[],
  albumTracks?: CatalogTrack[],
  albumTitle?: string,
  expectedTrackCount?: number,
): MediaEnvelope[] {
  if (!albumTracks?.length) {
    return displayHits
      .map((hit) => hit.primaryEnvelope)
      .filter(isSeededQueueEnvelope);
  }
  const rows = buildAlbumRenderRows(displayHits, albumTracks, albumTitle, expectedTrackCount);
  return rows
    .filter((row): row is Extract<typeof row, { kind: 'track' }> => row.kind === 'track')
    .map((row) => row.hit.primaryEnvelope)
    .filter(isSeededQueueEnvelope);
}

/**
 * Synchronous play-queue seed for a tap — must be used in handlePlayEnvelope before
 * in-place seek so React setState does not leave a stale queue index.
 */
export function computePlayQueueSeed(
  env: MediaEnvelope,
  options: {
    searchHits: ResolvedSearchHit[];
    searchResults: MediaEnvelope[];
    albumTracks?: CatalogTrack[];
    albumTitle?: string;
    expectedTrackCount?: number;
    /** Standalone single play — ignore stale album drill; fall back to lone tap. */
    seedSearchOnly?: boolean;
  },
): PlayQueueSeed | null {
  const tappedId = env.envelopeId?.trim();
  if (!tappedId) return null;

  const albumTracks = options.seedSearchOnly ? undefined : options.albumTracks;
  const albumTitle = options.seedSearchOnly ? undefined : options.albumTitle;
  const expectedTrackCount = options.seedSearchOnly ? undefined : options.expectedTrackCount;

  const albumOrdered =
    albumTracks && albumTracks.length > 0
      ? buildAlbumPlayQueueEnvelopes(
          options.searchHits,
          albumTracks,
          albumTitle,
          expectedTrackCount,
        )
      : null;

  const queue =
    albumOrdered && albumOrdered.length > 0
      ? albumOrdered
      : options.searchHits.length > 0
        ? options.searchHits.map((h) => h.primaryEnvelope).filter(isSeededQueueEnvelope)
        : options.searchResults.filter(isSeededQueueEnvelope);

  if (queue.length === 0) {
    if (options.seedSearchOnly) return { queue: [env], index: 0 };
    return null;
  }

  let index = queue.findIndex((e) => e.envelopeId === tappedId);
  if (index < 0 && isSeededQueueEnvelope(env)) {
    queue.unshift(env);
    index = 0;
  }
  return { queue, index: index >= 0 ? index : 0 };
}
