/**
 * Clear active download jobs when the locker already has the audio.
 */

import { getDownloadJobs, patchDownloadJob, type DownloadJob } from './downloadQueue';
import { getLockerEntries, tracksForAlbumGroup, type LockerEntry } from './lockerStorage';
import { fetchAlbumTracks } from './searchCatalog';
import { filterTracksNeedingDownload } from './downloadLockerPrecheck';

function isActiveJob(job: DownloadJob): boolean {
  return (
    job.status === 'queued' ||
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'metadata'
  );
}

function normTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normArtist(value: string): string {
  const key = value.trim().toLowerCase();
  return key.split(',')[0]?.trim() ?? key;
}

function lockerHasTrack(
  entries: LockerEntry[],
  title: string,
  artist: string,
  albumTitle?: string,
): boolean {
  const titleKey = normTitle(title);
  const artistKey = normArtist(artist);
  const albumKey = albumTitle?.trim().toLowerCase();
  return entries.some((entry) => {
    if (!entry.offlineReady) return false;
    if (normTitle(entry.title) !== titleKey) return false;
    if (normArtist(entry.artist) !== artistKey) return false;
    if (albumKey && (entry.albumName ?? '').trim().toLowerCase() !== albumKey) return false;
    return true;
  });
}

/** Mark stuck single-track jobs done when locker already contains the audio. */
export async function reconcileActiveDownloadJobsWithLocker(): Promise<number> {
  const entries = await getLockerEntries();
  let reconciled = 0;

  for (const job of getDownloadJobs()) {
    if (!isActiveJob(job)) continue;

    if (job.mode === 'tracks' && job.totalTracks <= 1) {
      if (lockerHasTrack(entries, job.label, job.artist, job.albumTitle)) {
        patchDownloadJob(job.id, {
          status: 'done',
          progress: 100,
          completedTracks: 1,
          currentTrack: undefined,
        });
        reconciled += 1;
      }
      continue;
    }

    if (job.mode === 'album' && job.totalTracks > 0) {
      const states = Object.values(job.tracks);
      if (states.length > 0 && states.every((s) => s.status === 'done' || s.status === 'skipped')) {
        patchDownloadJob(job.id, {
          status: 'done',
          progress: 100,
          completedTracks: states.length,
          currentTrack: undefined,
        });
        reconciled += 1;
        continue;
      }
      if (job.albumTitle) {
        const listing = await fetchAlbumTracks({
          kind: 'album',
          id: job.albumId ?? job.id,
          title: job.albumTitle,
          artist: job.artist,
        });
        if (listing.length > 0) {
          const precheck = await filterTracksNeedingDownload(listing, job.albumTitle);
          if (precheck.needing.length === 0) {
            patchDownloadJob(job.id, {
              status: 'done',
              progress: 100,
              completedTracks: listing.length,
              currentTrack: undefined,
            });
            reconciled += 1;
            continue;
          }
        }
      }
      if (job.completedTracks >= job.totalTracks) {
        patchDownloadJob(job.id, {
          status: 'done',
          progress: 100,
          currentTrack: undefined,
        });
        reconciled += 1;
      }
    }
  }

  return reconciled;
}


/** Mark paused/error album jobs done when locker already covers catalog (incl. heal signals). */
export async function reconcilePausedDownloadJobsWithLocker(): Promise<number> {
  const { summarizeLockerAlbumMissingTracks } = await import('./lockerAlbumCompletion');
  const entries = await getLockerEntries();
  let reconciled = 0;
  for (const job of getDownloadJobs()) {
    if (job.status === 'done') continue;
    if (job.mode !== 'album' || !job.albumTitle) continue;
    const albumTracks = tracksForAlbumGroup(entries, job.albumTitle, job.artist);
    if (albumTracks.length > 0) {
      const missing = summarizeLockerAlbumMissingTracks(albumTracks);
      if (missing.missingCount > 0) continue;
    }
    const listing = await fetchAlbumTracks({
      kind: 'album',
      id: job.albumId ?? job.id,
      title: job.albumTitle,
      artist: job.artist,
    });
    if (listing.length === 0) continue;
    const precheck = await filterTracksNeedingDownload(listing, job.albumTitle, {
      requirePlayable: true,
    });
    if (precheck.needing.length > 0) continue;
    patchDownloadJob(job.id, {
      status: 'done',
      progress: 100,
      completedTracks: listing.length,
      currentTrack: undefined,
      error: undefined,
    });
    reconciled += 1;
  }
  return reconciled;
}
