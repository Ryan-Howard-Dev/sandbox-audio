/**
 * Recover hollow locker rows — re-queue catalog download for missing tracks
 * when siblings in the same album are playable offline.
 */

import { scheduleDownloadJob } from './downloadQueueRunner';
import { acquireTracksOnServer } from './acquisitionPipeline';
import { isOrphanLockerTrack } from './collectionIntelligence';
import {
  enqueueDownloadJob,
  findAlbumDownloadJob,
  findTrackDownloadJob,
  getDownloadJobs,
  initJobTracks,
  isDownloadJobActivelyRunning,
  loadDownloadTierPreference,
  patchDownloadJob,
  trackTitleKeysMatch,
  type DownloadTierPreference,
} from './downloadQueue';
import { queueDeadLockerTrackReacquire } from './lockerDeadTrackReacquire';
import { filterTracksNeedingDownload } from './downloadLockerPrecheck';
import { canAutoResumeDownloadJob } from './downloadResumeGate';
import { groupTracksByEnvelope } from './groupTracksByEnvelope';
import type { LockerEntry } from './lockerStorage';
import { getLockerEntries, lockerAlbumGroupKey, tracksForAlbumGroup } from './lockerStorage';
import { fetchAlbumTracks, type CatalogAlbum, type CatalogTrack } from './searchCatalog';
import { isAirGapEnabled } from './airGapMode';

export type LockerMissingTrackSummary = {
  missingCount: number;
  playableCount: number;
  missingTitles: string[];
};

/** Unique track rows with no playable offline audio. */
export function summarizeLockerAlbumMissingTracks(
  tracks: LockerEntry[],
): LockerMissingTrackSummary {
  const groups = groupTracksByEnvelope(tracks);
  const missingTitles: string[] = [];
  let playableCount = 0;
  for (const group of groups) {
    const playable = group.entries.some((e) => e.offlineReady === true);
    if (playable) {
      playableCount += 1;
      continue;
    }
    if (group.primary.offlineReady !== true) {
      missingTitles.push(group.primary.title);
    }
  }
  return {
    missingCount: missingTitles.length,
    playableCount,
    missingTitles,
  };
}

/** User started a full-album download (any job status — incl. done/hollow). */
export function albumHadFullDownloadIntent(
  albumName: string,
  artist: string,
): boolean {
  return Boolean(findAlbumDownloadJob(artist, albumName));
}

/** Locker rows stamped by a prior catalog download (job may have been cleared). */
export function lockerAlbumLooksDownloaded(tracks: LockerEntry[]): boolean {
  if (tracks.length === 0) return false;
  const stamped = tracks.filter(
    (t) => (t.genre ?? '').trim().toLowerCase() === 'downloaded',
  ).length;
  return stamped >= Math.max(1, Math.ceil(tracks.length * 0.75));
}

function albumHadPriorFullDownload(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
): boolean {
  const albumArtist = resolveAlbumArtist(tracks, artist);
  return (
    albumHadFullDownloadIntent(albumName, albumArtist) ||
    lockerAlbumLooksDownloaded(tracks)
  );
}

/** Tidal-like: auto-fetch when album download was started and audio is still missing. */
export function shouldAutoQueueLockerAlbumMissingTracks(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
): boolean {
  const { missingCount, playableCount } = summarizeLockerAlbumMissingTracks(tracks);
  if (missingCount > 0 && playableCount > 0) return true;
  const albumArtist = resolveAlbumArtist(tracks, artist);
  if (playableCount > 0 && albumHadPriorFullDownload(albumName, albumArtist, tracks)) {
    return true;
  }
  if (playableCount > 0) return false;
  return albumHadPriorFullDownload(albumName, albumArtist, tracks);
}

export function shouldOfferLockerAlbumCompletion(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
): boolean {
  return shouldAutoQueueLockerAlbumMissingTracks(albumName, artist, tracks);
}

function resolveAlbumArtist(tracks: LockerEntry[], fallbackArtist: string): string {
  const withAlbumArtist = tracks.find((t) => t.albumArtist?.trim());
  return (withAlbumArtist?.albumArtist ?? fallbackArtist).trim();
}

function catalogTracksFromLockerRows(
  albumName: string,
  artist: string,
  missingTitles: string[],
  tracks: LockerEntry[],
): CatalogTrack[] {
  const groups = groupTracksByEnvelope(tracks);
  const out: CatalogTrack[] = [];
  for (const title of missingTitles) {
    const group = groups.find((g) => trackTitleKeysMatch(g.primary.title, title));
    const entry =
      group?.primary ??
      tracks.find((t) => trackTitleKeysMatch(t.title, title));
    if (!entry) continue;
    out.push({
      kind: 'track',
      id: entry.id,
      title: entry.title,
      artist: entry.artist || artist,
      album: albumName,
    });
  }
  return out;
}

async function catalogTracksForMissing(
  albumName: string,
  artist: string,
  missingTitles: string[],
  lockerTracks: LockerEntry[],
): Promise<CatalogTrack[]> {
  const album: CatalogAlbum = {
    kind: 'album',
    id: `locker-complete-${albumName}-${artist}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: albumName,
    artist,
  };
  const listing = await fetchAlbumTracks(album);
  if (listing.length === 0) {
    return catalogTracksFromLockerRows(albumName, artist, missingTitles, lockerTracks);
  }
  const wanted = new Set(missingTitles.map((t) => t.trim().toLowerCase()));
  const matched = listing.filter((t) =>
    [...wanted].some((w) => trackTitleKeysMatch(t.title, w)),
  );
  if (matched.length > 0) return matched;
  return catalogTracksFromLockerRows(albumName, artist, missingTitles, lockerTracks);
}

/**
 * Queue download for missing tracks only — reuses an in-flight job when possible.
 * Returns job id when queued, undefined when nothing to do.
 */
export async function queueLockerAlbumMissingTracks(
  albumName: string,
  artist: string,
  tracks: LockerEntry[],
  tier: DownloadTierPreference = loadDownloadTierPreference(),
): Promise<string | undefined> {
  const summary = summarizeLockerAlbumMissingTracks(tracks);
  const albumArtist = resolveAlbumArtist(tracks, artist);

  const albumForCatalog: CatalogAlbum = {
    kind: 'album',
    id: `locker-complete-${albumName}-${albumArtist}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: albumName,
    artist: albumArtist,
  };
  const catalogListing = await fetchAlbumTracks(albumForCatalog);
  if (catalogListing.length > 0) {
    const catalogPrecheck = await filterTracksNeedingDownload(catalogListing, albumName, {
      requirePlayable: true,
    });
    if (catalogPrecheck.needing.length > 0) {
      const existing = findAlbumDownloadJob(albumArtist, albumName);
      if (existing && isDownloadJobActivelyRunning(existing)) {
        return existing.id;
      }
      const job =
        existing ??
        enqueueDownloadJob({
          label: albumName,
          artist: albumArtist,
          albumTitle: albumName,
          mode: 'album',
          tier,
          totalTracks: catalogPrecheck.needing.length,
        });
      if (job.status === 'done' || job.status === 'error' || job.status === 'paused') {
        patchDownloadJob(job.id, { status: 'queued', error: undefined });
      }
      initJobTracks(
        job.id,
        catalogPrecheck.needing.map((t) => ({ id: t.id, title: t.title })),
      );
      const album: CatalogAlbum = {
        kind: 'album',
        id: job.albumId ?? job.id,
        title: albumName,
        artist: albumArtist,
        trackCount: Math.max(albumForCatalog.trackCount ?? 0, catalogListing.length),
      };
      scheduleDownloadJob(job.id, async () => {
        try {
          await acquireTracksOnServer(catalogPrecheck.needing, {
            tier,
            mode: 'album',
            album,
            albumName,
            albumArtist,
            jobId: job.id,
          });
        } catch (err) {
          patchDownloadJob(job.id, { status: 'error', error: String(err) });
        }
      });
      return job.id;
    }
  }

  if (summary.missingCount === 0) return undefined;

  if (summary.playableCount === 0 && !albumHadPriorFullDownload(albumName, albumArtist, tracks)) {
    return undefined;
  }

  const existing = findAlbumDownloadJob(albumArtist, albumName);
  if (existing && isDownloadJobActivelyRunning(existing)) {
    return existing.id;
  }

  const catalogTracks = await catalogTracksForMissing(
    albumName,
    albumArtist,
    summary.missingTitles,
    tracks,
  );
  if (catalogTracks.length === 0) return undefined;

  const precheck = await filterTracksNeedingDownload(catalogTracks, albumName, {
    requirePlayable: true,
  });
  if (precheck.needing.length === 0) return undefined;
  const tracksToAcquire = precheck.needing;

  const job =
    existing ??
    enqueueDownloadJob({
      label: albumName,
      artist: albumArtist,
      albumTitle: albumName,
      mode: 'album',
      tier,
      totalTracks: tracksToAcquire.length,
    });

  if (job.status === 'done' || job.status === 'error' || job.status === 'paused') {
    patchDownloadJob(job.id, { status: 'queued', error: undefined });
  }

  initJobTracks(
    job.id,
    tracksToAcquire.map((t) => ({ id: t.id, title: t.title })),
  );

  const album: CatalogAlbum = {
    kind: 'album',
    id: job.albumId ?? job.id,
    title: albumName,
    artist: albumArtist,
  };

  scheduleDownloadJob(job.id, async () => {
    try {
      await acquireTracksOnServer(tracksToAcquire, {
        tier: job.tier,
        mode: 'album',
        album,
        albumName,
        albumArtist,
        jobId: job.id,
      });
    } catch (err) {
      patchDownloadJob(job.id, { status: 'error', error: String(err) });
    }
  });

  return job.id;
}

/**
 * True when a completion download is already in flight or waiting in the serial queue.
 * Error/paused jobs with hollow locker rows are not "pending" — scan may re-queue them.
 */
export function isLockerAlbumCompletionPending(
  albumName: string,
  artist: string,
): boolean {
  const job = findAlbumDownloadJob(artist, albumName);
  if (!job) return false;
  if (job.status === 'done') return false;
  if (isDownloadJobActivelyRunning(job)) return true;
  if (job.status === 'queued' && Object.keys(job.tracks).length > 0) return true;
  return false;
}

/**
 * After boot heal + revalidate: auto-queue missing tracks for album download jobs
 * (Tidal-like — no second tap when user already started a full album download).
 */
export async function autoQueueIncompleteAlbumDownloads(
  entries?: LockerEntry[],
): Promise<number> {
  if (isAirGapEnabled()) return 0;
  const list = entries ?? (await getLockerEntries());
  const seen = new Set<string>();
  let queued = 0;

  const tryQueueAlbum = async (
    albumName: string,
    albumArtist: string,
    albumTracks: LockerEntry[],
  ): Promise<void> => {
    const key = `${albumArtist.toLowerCase()}|${albumName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (albumTracks.length === 0) return;
    if (!shouldAutoQueueLockerAlbumMissingTracks(albumName, albumArtist, albumTracks)) {
      return;
    }
    if (isLockerAlbumCompletionPending(albumName, albumArtist)) return;
    const existingJob = findAlbumDownloadJob(albumArtist, albumName);
    if (existingJob && !canAutoResumeDownloadJob(existingJob)) return;
    const jobId = await queueLockerAlbumMissingTracks(albumName, albumArtist, albumTracks);
    if (jobId) queued += 1;
  };

  for (const job of getDownloadJobs()) {
    if (job.mode !== 'album' || !job.albumTitle?.trim()) continue;
    if (isDownloadJobActivelyRunning(job)) continue;
    const albumArtist = job.artist.trim();
    const albumName = job.albumTitle.trim();
    const albumTracks = tracksForAlbumGroup(list, albumName, albumArtist);
    await tryQueueAlbum(albumName, albumArtist, albumTracks);
  }

  const albumsByKey = new Map<string, { albumName: string; artist: string; tracks: LockerEntry[] }>();
  for (const entry of list) {
    const key = lockerAlbumGroupKey(entry);
    if (!key) continue;
    const albumName = entry.albumName?.trim();
    if (!albumName) continue;
    const artist = resolveAlbumArtist([entry], entry.artist);
    const bucket = albumsByKey.get(key) ?? { albumName, artist, tracks: [] };
    bucket.tracks.push(entry);
    albumsByKey.set(key, bucket);
  }
  for (const { albumName, artist, tracks } of albumsByKey.values()) {
    await tryQueueAlbum(albumName, artist, tracks);
  }

  const tryQueueSingle = async (
    title: string,
    artist: string,
    albumName?: string,
    dedupeKey?: string,
  ): Promise<void> => {
    const key = dedupeKey ?? `single|${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const outcome = await queueDeadLockerTrackReacquire(title, artist, albumName);
    if (outcome === 'queued') queued += 1;
  };

  for (const job of getDownloadJobs()) {
    if (job.mode !== 'tracks' || job.totalTracks > 1) continue;
    if (isDownloadJobActivelyRunning(job)) continue;
    const title = job.label.trim();
    const artist = job.artist.trim();
    if (!title || !artist) continue;
    await tryQueueSingle(title, artist, job.albumTitle?.trim(), `job|${job.id}`);
  }

  for (const entry of list) {
    if (!isOrphanLockerTrack(entry)) continue;
    if (entry.offlineReady === true) continue;
    const title = entry.title?.trim();
    const artist = entry.artist?.trim();
    if (!title || !artist) continue;
    const stampedDownloaded =
      (entry.genre ?? '').trim().toLowerCase() === 'downloaded';
    if (!stampedDownloaded && !findTrackDownloadJob(artist, title, entry.id)) continue;
    await tryQueueSingle(title, artist, undefined, `orphan|${entry.id}`);
  }

  return queued;
}

/** Boot + downloads sheet entry — heal queue state then drain. */
export async function scanAndQueueIncompleteAlbumDownloads(
  _entries?: LockerEntry[],
): Promise<number> {
  const { autoResumePausedDownloadJobs } = await import('./acquisitionPipeline');
  return autoResumePausedDownloadJobs({ force: true });
}
