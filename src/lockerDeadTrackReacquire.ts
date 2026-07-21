/**
 * Tidal-like self-heal — re-queue acquisition for hollow locker rows instead of duplicating.
 */

import { isAirGapEnabled } from './airGapMode';
import { scheduleCatalogTrackDownload } from './acquisitionPipeline';
import {
  enqueueDownloadJob,
  findTrackDownloadJob,
  initJobTracks,
  isDownloadJobActivelyRunning,
  loadDownloadTierPreference,
  type DownloadJob,
} from './downloadQueue';
import {
  findLockerEntryForTrackIncludingHollow,
  findPlayableLockerEntryForTrack,
  lockerEntryHasRecoverableAudio,
} from './lockerStorage';
import type { CatalogTrack } from './searchCatalog';

export type DeadLockerReacquireOutcome = 'queued' | 'already-active' | 'playable' | 'blocked';

function isActiveReacquireJob(job: DownloadJob | undefined): boolean {
  if (!job) return false;
  if (job.status === 'done' || job.status === 'error') return false;
  return isDownloadJobActivelyRunning(job);
}

/**
 * Queue a single-track download that replaces an existing hollow locker row when possible.
 */
export async function queueDeadLockerTrackReacquire(
  title: string,
  artist: string,
  albumName?: string,
): Promise<DeadLockerReacquireOutcome> {
  if (isAirGapEnabled()) return 'blocked';
  if (await findPlayableLockerEntryForTrack(title, artist, albumName)) return 'playable';

  const hollow = findLockerEntryForTrackIncludingHollow(title, artist, albumName);
  if (hollow && (await lockerEntryHasRecoverableAudio(hollow.id))) return 'playable';

  const existing = findTrackDownloadJob(artist, title);
  if (isActiveReacquireJob(existing)) return 'already-active';

  const track: CatalogTrack = {
    kind: 'track',
    id: hollow?.id ?? `reacquire-${title}-${artist}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    artist,
    album: albumName,
  };

  const tier = loadDownloadTierPreference();
  const job =
    existing && existing.status !== 'done' && existing.status !== 'error'
      ? existing
      : enqueueDownloadJob({
          label: title,
          artist,
          albumTitle: albumName,
          mode: 'tracks',
          tier,
          totalTracks: 1,
        });

  initJobTracks(job.id, [{ id: track.id, title: track.title }]);
  scheduleCatalogTrackDownload(track, tier, job.id);
  return 'queued';
}

/** True when a background re-download was queued or is already running. */
export async function attemptDeadLockerReacquire(
  title: string,
  artist: string,
  albumName?: string,
): Promise<boolean> {
  const outcome = await queueDeadLockerTrackReacquire(title, artist, albumName);
  return outcome === 'queued' || outcome === 'already-active';
}
