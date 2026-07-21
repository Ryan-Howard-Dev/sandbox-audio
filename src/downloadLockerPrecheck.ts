/**
 * Skip download enqueue when locker already has playable audio.
 */

import { fetchAlbumTracks, type CatalogAlbum, type CatalogTrack } from './searchCatalog';
import {
  findPlayableLockerEntryForTrack,
  findLockerEntryForTrackIncludingHollow,
  lockerEntryHasRecoverableAudio,
  getLockerEntries,
  tracksForAlbumGroup,
} from './lockerStorage';
import {
  getDownloadJobs,
  patchDownloadJob,
  removeDownloadJob,
  type DownloadJob,
} from './downloadQueue';
import { syncDownloadForegroundState } from './downloadForeground';

export type LockerDownloadPrecheck = {
  needing: CatalogTrack[];
  skipped: number;
  total: number;
};

/** Tracks that still need acquisition — locker-playable rows are omitted. */
export async function filterTracksNeedingDownload(
  tracks: CatalogTrack[],
  albumName?: string,
  opts?: { requirePlayable?: boolean },
): Promise<LockerDownloadPrecheck> {
  const needing: CatalogTrack[] = [];
  let skipped = 0;
  for (const track of tracks) {
    const playable = await findPlayableLockerEntryForTrack(
      track.title,
      track.artist,
      albumName ?? track.album,
    );
    if (playable) {
      skipped += 1;
      continue;
    }
    if (!opts?.requirePlayable) {
      const hollow = findLockerEntryForTrackIncludingHollow(
        track.title,
        track.artist,
        albumName ?? track.album,
      );
      if (hollow && (await lockerEntryHasRecoverableAudio(hollow.id))) {
        skipped += 1;
        continue;
      }
    }
    needing.push(track);
  }
  return { needing, skipped, total: tracks.length };
}

/** True when every listed track already has playable locker audio. */
export async function areAllTracksInLocker(
  tracks: CatalogTrack[],
  albumName?: string,
  expectedTrackCount?: number,
): Promise<boolean> {
  if (tracks.length === 0) return false;
  const { needing, total } = await filterTracksNeedingDownload(tracks, albumName, {
    requirePlayable: true,
  });
  if (needing.length > 0) return false;
  const expected = Math.max(expectedTrackCount ?? 0, total);
  if (expected > 0 && total < expected) return false;
  return true;
}

export type CatalogLockerCoverage = {
  listing: CatalogTrack[];
  needing: CatalogTrack[];
  expectedTrackCount: number;
  fullyInLocker: boolean;
};

/**
 * Compare a catalog listing against locker — treats short listings as partial
 * when album metadata advertises more tracks than were resolved.
 */
export async function resolveCatalogLockerCoverage(
  album: CatalogAlbum,
  opts?: { listing?: CatalogTrack[]; albumName?: string },
): Promise<CatalogLockerCoverage> {
  const listing = opts?.listing ?? (await fetchAlbumTracks(album));
  const expectedTrackCount = Math.max(album.trackCount ?? 0, listing.length);
  const albumName = opts?.albumName ?? album.title;
  const precheck = await filterTracksNeedingDownload(listing, albumName, {
    requirePlayable: true,
  });
  const fullyInLocker =
    precheck.needing.length === 0 &&
    expectedTrackCount > 0 &&
    listing.length >= expectedTrackCount;
  return {
    listing,
    needing: precheck.needing,
    expectedTrackCount,
    fullyInLocker,
  };
}

export type LockerAlbumSummary = {
  albumName: string;
  artist: string;
  playableCount: number;
  totalInLocker: number;
  fullyDownloaded: boolean;
};

/** Summarize locker coverage for an album without starting a download. */
export async function summarizeLockerAlbum(
  albumName: string,
  artist: string,
  catalogTrackCount?: number,
): Promise<LockerAlbumSummary> {
  const entries = await getLockerEntries();
  const group = tracksForAlbumGroup(entries, albumName, artist);
  const playableCount = group.filter((e) => e.offlineReady === true).length;
  const lockerRows = group.length;
  const total = Math.max(catalogTrackCount ?? 0, lockerRows);
  const fullyDownloaded =
    total > 0 && playableCount >= total && lockerRows >= total;
  return {
    albumName,
    artist,
    playableCount,
    totalInLocker: group.length,
    fullyDownloaded,
  };
}

function isCancellableJob(job: DownloadJob): boolean {
  return (
    job.status === 'queued' ||
    job.status === 'paused' ||
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'metadata'
  );
}

/** Stop active download jobs without touching locker blobs. */
export async function cancelAllActiveDownloadJobs(): Promise<number> {
  let cancelled = 0;
  for (const job of getDownloadJobs()) {
    if (!isCancellableJob(job)) continue;
    patchDownloadJob(job.id, {
      status: 'error',
      error: 'cancelled',
      currentTrack: undefined,
    });
    removeDownloadJob(job.id);
    cancelled += 1;
  }
  await syncDownloadForegroundState({ active: false });
  return cancelled;
}
