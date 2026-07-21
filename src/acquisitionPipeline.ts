/**
 * Catalog acquisition — submit to Tier 3/4 worker, poll status, sync blobs to Locker.
 */

import { isAirGapEnabled } from './airGapMode';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import type { DownloadMode, DownloadTierPreference } from './downloadQueue';
import {
  getDownloadJobs,
  initJobTracks,
  isDownloadJobActivelyRunning,
  listDownloadJobsNeedingResume,
  patchDownloadJob,
  patchTrackDownload,
  revalidateDownloadQueueAgainstLocker,
  resetDownloadJobForRetry,
  resetTrackDownloadForRetry,
  type DownloadJob,
} from './downloadQueue';
import {
  beginDownloadJobAcquire,
  isDownloadJobAcquiring,
  notifyDownloadJobFinished,
  scheduleDownloadJob,
} from './downloadQueueRunner';
import { shouldPauseDownloadsForBattery, DOWNLOAD_BATTERY_PAUSE_MESSAGE } from './downloadBatteryGate';
import { loadPlaybackEngineSettings } from './playbackEngineSettings';
import { findLockerEntryForTrack, getLockerEntries, lockerEntryIsPlayable } from './lockerStorage';
import {
  importManifestEntryWithBlob,
  pullBlobFromTier34,
  pullManifestFromTier34,
  type LockerSyncManifestEntry,
} from './lockerSync';
import type { CatalogAlbum, CatalogTrack } from './searchCatalog';
import { fetchAlbumTracks } from './searchCatalog';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getTier34BaseUrl, tier34HealthOk } from './tier34/client';
import { acquireTracksOnMobile, canAcquireOnMobile } from './mobileAcquisition';
import { ensureDownloadedAlbumCover } from './lockerAlbumBackfill';
import { resolveCatalogLockerCoverage } from './downloadLockerPrecheck';
import { reconcilePausedDownloadJobsWithLocker } from './downloadJobReconcile';
import {
  canAutoResumeDownloadJob,
  markAutoResumeScan,
  recordAutoResumeAttempt,
  shouldThrottleAutoResumeScan,
} from './downloadResumeGate';

const POLL_INTERVAL_MS = 1_200;
const POLL_TIMEOUT_MS = 600_000;

export { isDownloadJobAcquiring } from './downloadQueueRunner';

type ServerTrackStatus =
  | 'pending'
  | 'resolving'
  | 'downloading'
  | 'enriching'
  | 'done'
  | 'error'
  | 'skipped';

type ServerAcquireStatus = {
  id: string;
  status: 'queued' | 'running' | 'metadata' | 'done' | 'error';
  progress: number;
  currentTrack?: string;
  tracks: Record<
    string,
    {
      trackId: string;
      title: string;
      status: ServerTrackStatus;
      percent: number;
      errorMessage?: string;
      contentHash?: string;
      lockerId?: string;
      skipReason?: string;
      acoustidScore?: number;
      musicbrainzRecordingId?: string;
    }
  >;
  error?: string;
};

function mapServerTrackStatus(status: ServerTrackStatus): Parameters<typeof patchTrackDownload>[2]['status'] {
  if (status === 'enriching') return 'metadata';
  return status;
}

function mapServerJobStatus(
  status: ServerAcquireStatus['status'],
): Parameters<typeof patchDownloadJob>[1]['status'] {
  if (status === 'running') return 'downloading';
  if (status === 'queued') return 'queued';
  return status;
}

async function formatNoSourceError(
  trackTitle: string,
  tier: DownloadTierPreference,
): Promise<string> {
  const tier34Up = await tier34HealthOk();
  if (!tier34Up) {
    return `No source for "${trackTitle}". Downloads need Sandbox Server (Settings → Addons → Server URL). For streaming without server, use Play — on-device yt-dlp resolves streams on Android.`;
  }
  if (tier === 'debrid') {
    return `No debrid source for "${trackTitle}". Sandbox Indexer uses Archive.org by default — add Real-Debrid for premium torrents or optional Prowlarr/Jackett in Settings → Addons.`;
  }
  return `No full-length source for "${trackTitle}". Install yt-dlp on the Sandbox Server host or configure debrid in Settings.`;
}

function summarizeJobError(errors: string[], failed: number, saved: number): string {
  const first = errors.find((e) => e.trim()) ?? `${failed} track(s) failed`;
  if (saved > 0) return `${failed} track(s) failed — ${first}`;
  return first;
}

async function lockerHasTrack(
  title: string,
  artist: string,
  albumName?: string,
): Promise<boolean> {
  const entries = await getLockerEntries();
  const entry = findLockerEntryForTrack(title, artist, albumName, entries);
  if (!entry) return false;
  return lockerEntryIsPlayable(entry.id);
}

async function submitAcquireJob(body: Record<string, unknown>): Promise<string> {
  if (isAirGapEnabled()) {
    throw new Error('Acquisition is disabled while Air-Gap Mode is active.');
  }
  const base = getTier34BaseUrl().replace(/\/$/, '');
  const res = await fetchWithTimeout(`${base}/api/acquire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 30_000);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Acquire submit failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`);
  }
  const data = (await res.json()) as { jobId?: string };
  if (!data.jobId) throw new Error('Acquire submit missing jobId');
  return data.jobId;
}

async function fetchAcquireStatus(serverJobId: string): Promise<ServerAcquireStatus> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  const res = await fetchWithTimeout(
    `${base}/api/acquire/status/${encodeURIComponent(serverJobId)}`,
    undefined,
    15_000,
  );
  if (!res.ok) throw new Error(`Acquire status failed (HTTP ${res.status})`);
  return (await res.json()) as ServerAcquireStatus;
}

function applyServerStatusToJob(
  clientJobId: string,
  status: ServerAcquireStatus,
  lockerSyncedTrackIds: ReadonlySet<string>,
): void {
  patchDownloadJob(clientJobId, {
    status: mapServerJobStatus(status.status),
    progress: status.progress,
    currentTrack: status.currentTrack,
    error: status.error,
  });
  for (const track of Object.values(status.tracks)) {
    const serverComplete = track.status === 'done' || track.status === 'skipped';
    const lockerReady = serverComplete && lockerSyncedTrackIds.has(track.trackId);
    patchTrackDownload(clientJobId, track.trackId, {
      status:
        track.status === 'done' && !lockerReady
          ? 'downloading'
          : mapServerTrackStatus(track.status),
      percent: track.status === 'done' && !lockerReady ? Math.max(track.percent, 95) : track.percent,
      errorMessage: track.errorMessage ?? track.skipReason,
    });
  }
}

async function pollAcquireUntilDone(
  serverJobId: string,
  clientJobId?: string,
  syncCtx?: Omit<SyncTrackContext, 'manifestRows'>,
  lockerSyncedTrackIds: Set<string> = new Set(),
): Promise<ServerAcquireStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: ServerAcquireStatus | null = null;
  let manifestRows: LockerSyncManifestEntry[] = [];

  while (Date.now() < deadline) {
    last = await fetchAcquireStatus(serverJobId);

    if (clientJobId && syncCtx) {
      for (const track of Object.values(last.tracks)) {
        if (
          (track.status !== 'done' && track.status !== 'skipped') ||
          !track.contentHash ||
          lockerSyncedTrackIds.has(track.trackId)
        ) {
          continue;
        }
        try {
          if (manifestRows.length === 0) {
            try {
              const manifest = await pullManifestFromTier34();
              manifestRows = manifest.entries;
            } catch {
              /* manifest optional */
            }
          }
          const outcome = await syncOneAcquiredTrackToLocker(track, {
            ...syncCtx,
            manifestRows,
          });
          lockerSyncedTrackIds.add(track.trackId);
          patchTrackDownload(clientJobId, track.trackId, {
            status: track.status === 'skipped' ? 'skipped' : 'done',
            percent: 100,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          patchTrackDownload(clientJobId, track.trackId, {
            status: 'downloading',
            percent: 95,
            errorMessage: msg,
          });
        }
      }
    }

    if (clientJobId) applyServerStatusToJob(clientJobId, last, lockerSyncedTrackIds);
    if (last.status === 'done' || last.status === 'error') return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Acquire job timed out — server may still be running');
}

type SyncTrackContext = {
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  trackArtists?: Record<string, string>;
  manifestRows: LockerSyncManifestEntry[];
};

async function syncOneAcquiredTrackToLocker(
  track: ServerAcquireStatus['tracks'][string],
  ctx: SyncTrackContext,
): Promise<'saved' | 'skipped' | 'error'> {
  const complete = track.status === 'done' || track.status === 'skipped';
  if (!complete || !track.contentHash) {
    return track.status === 'skipped' ? 'skipped' : 'error';
  }

  try {
    const blob = await pullBlobFromTier34(track.contentHash);
    const row =
      ctx.manifestRows.find((r) => r.id === track.lockerId) ??
      ctx.manifestRows.find((r) => r.contentHash === track.contentHash) ?? {
        id: track.lockerId ?? `locker-acq-${track.trackId}`,
        contentHash: track.contentHash,
        title: track.title,
        artist: ctx.trackArtists?.[track.trackId] ?? ctx.albumArtist ?? 'Unknown Artist',
        albumName: ctx.albumName,
        releaseYear: ctx.releaseYear,
        durationSeconds: 0,
        addedAt: Date.now(),
        version: 1,
      };

    const entry = await importManifestEntryWithBlob(row, blob);
    return entry ? 'saved' : 'skipped';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }
}

async function syncAcquiredTracksToLocker(
  serverStatus: ServerAcquireStatus,
  ctx: Omit<SyncTrackContext, 'manifestRows'>,
  alreadySynced: Set<string>,
): Promise<{ saved: number; skipped: number; errors: string[] }> {
  let saved = 0;
  let skipped = 0;
  const errors: string[] = [];

  let manifestRows: LockerSyncManifestEntry[] = [];
  try {
    const manifest = await pullManifestFromTier34();
    manifestRows = manifest.entries;
  } catch {
    /* manifest optional */
  }

  const syncCtx: SyncTrackContext = { ...ctx, manifestRows };

  for (const track of Object.values(serverStatus.tracks)) {
    const complete = track.status === 'done' || track.status === 'skipped';
    if (!complete || !track.contentHash) {
      if (track.status === 'skipped') skipped += 1;
      continue;
    }
    if (alreadySynced.has(track.trackId)) {
      skipped += 1;
      continue;
    }

    try {
      const outcome = await syncOneAcquiredTrackToLocker(track, syncCtx);
      alreadySynced.add(track.trackId);
      if (outcome === 'saved') saved += 1;
      else skipped += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }

  return { saved, skipped, errors };
}

export async function acquireTracksOnServer(
  tracks: CatalogTrack[],
  options: {
    tier: DownloadTierPreference;
    mode: DownloadMode;
    album?: CatalogAlbum;
    albumName?: string;
    albumArtist?: string;
    releaseYear?: string;
    jobId?: string;
  },
): Promise<AcquisitionResult> {
  const releaseAcquire = beginDownloadJobAcquire(options.jobId);
  try {
    return await acquireTracksOnServerInner(tracks, options);
  } finally {
    releaseAcquire();
    notifyDownloadJobFinished(options.jobId);
  }
}

async function acquireTracksOnServerInner(
  tracks: CatalogTrack[],
  options: {
    tier: DownloadTierPreference;
    mode: DownloadMode;
    album?: CatalogAlbum;
    albumName?: string;
    albumArtist?: string;
    releaseYear?: string;
    jobId?: string;
  },
): Promise<AcquisitionResult> {
  if (await shouldPauseDownloadsForBattery()) {
    if (options.jobId) {
      patchDownloadJob(options.jobId, {
        status: 'paused',
        error: DOWNLOAD_BATTERY_PAUSE_MESSAGE,
        currentTrack: undefined,
      });
    }
    return { saved: 0, skipped: 0, failed: 0, errors: [] };
  }

  const engine = loadPlaybackEngineSettings();
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const pending: CatalogTrack[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const albumName = options.albumName;
    if (await lockerHasTrack(track.title, track.artist, albumName)) {
      skipped += 1;
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, { status: 'skipped', percent: 100 });
        patchDownloadJob(options.jobId, {
          completedTracks: i + 1,
          progress: Math.round(((i + 1) / tracks.length) * 100),
        });
      }
      continue;
    }
    pending.push(track);
  }

  if (pending.length === 0) {
    if (options.albumName) {
      try {
        await ensureDownloadedAlbumCover({
          albumName: options.albumName,
          albumArtist: options.albumArtist ?? options.album?.artist,
          artworkUrl: options.album?.artworkUrl,
          releaseYear: options.releaseYear ?? options.album?.releaseYear,
        });
      } catch (err) {
        console.warn('[acquisition] album cover persist failed (all skipped):', err);
      }
    }
    if (options.jobId) {
      patchDownloadJob(options.jobId, { status: 'done', progress: 100 });
    }
    return { saved, skipped, failed, errors };
  }

  if (!(await tier34HealthOk())) {
    if (canAcquireOnMobile()) {
      return acquireTracksOnMobile(pending, {
        mode: options.mode,
        albumName: options.albumName,
        albumArtist: options.albumArtist,
        releaseYear: options.releaseYear,
        artworkUrl: options.album?.artworkUrl,
        jobId: options.jobId,
      });
    }
    const msg = await formatNoSourceError(pending[0].title, options.tier);
    throw new Error(msg);
  }

  if (options.jobId) {
    patchDownloadJob(options.jobId, { status: 'resolving' });
  }

  const serverJobId = await submitAcquireJob({
    tracks: pending.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      albumName: options.albumName ?? t.album,
      albumArtist: options.albumArtist,
      releaseYear: options.releaseYear ?? t.releaseYear,
      durationSeconds: t.durationSeconds,
      artworkUrl: t.artworkUrl ?? options.album?.artworkUrl,
    })),
    tier: options.tier,
    mode: options.mode,
    albumTitle: options.albumName ?? options.album?.title,
    albumArtist: options.albumArtist ?? options.album?.artist,
    releaseYear: options.releaseYear ?? options.album?.releaseYear,
    artworkUrl: options.album?.artworkUrl,
    prowlarrUrl: engine.prowlarrUrl,
    prowlarrApiKey: engine.prowlarrApiKey,
    realDebridApiKey: engine.realDebridApiKey,
  });

  const syncCtx = {
    albumName: options.albumName ?? options.album?.title,
    albumArtist: options.albumArtist ?? options.album?.artist,
    releaseYear: options.releaseYear ?? options.album?.releaseYear,
    trackArtists: Object.fromEntries(pending.map((t) => [t.id, t.artist])),
  };
  const lockerSyncedTrackIds = new Set<string>();
  const serverStatus = await pollAcquireUntilDone(
    serverJobId,
    options.jobId,
    syncCtx,
    lockerSyncedTrackIds,
  );

  const serverErrors = Object.values(serverStatus.tracks).filter((t) => t.status === 'error');
  failed = serverErrors.length;
  for (const t of serverErrors) {
    if (t.errorMessage) errors.push(t.errorMessage);
  }

  const syncResult = await syncAcquiredTracksToLocker(
    serverStatus,
    syncCtx,
    lockerSyncedTrackIds,
  );
  saved = syncResult.saved;
  skipped += syncResult.skipped;
  errors.push(...syncResult.errors);

  const resolvedAlbumName = options.albumName ?? options.album?.title;
  if (resolvedAlbumName) {
    try {
      await ensureDownloadedAlbumCover({
        albumName: resolvedAlbumName,
        albumArtist: options.albumArtist ?? options.album?.artist,
        artworkUrl:
          options.album?.artworkUrl ?? pending.find((t) => t.artworkUrl?.trim())?.artworkUrl,
        releaseYear: options.releaseYear ?? options.album?.releaseYear,
      });
    } catch (err) {
      console.warn('[acquisition] album cover persist failed after server sync:', err);
    }
  }

  if (options.jobId) {
    patchDownloadJob(options.jobId, {
      status: failed === tracks.length ? 'error' : 'done',
      progress: 100,
      error:
        failed > 0 || errors.length > 0
          ? summarizeJobError(errors, failed, saved)
          : undefined,
    });
  }

  return { saved, skipped, failed, errors };
}

export interface AcquisitionResult {
  saved: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function acquireCatalogTracks(
  tracks: CatalogTrack[],
  tier: DownloadTierPreference,
  jobId?: string,
  mode: DownloadMode = 'tracks',
): Promise<AcquisitionResult> {
  if (!tracks.length) {
    return { saved: 0, skipped: 0, failed: 0, errors: [] };
  }
  if (jobId) {
    if (tracks.length <= 40) {
      initJobTracks(jobId, tracks);
    } else {
      patchDownloadJob(jobId, { status: 'resolving', totalTracks: tracks.length });
    }
  }
  return acquireTracksOnServer(tracks, { tier, mode, jobId });
}

export async function acquireCatalogAlbum(
  album: CatalogAlbum,
  mode: DownloadMode,
  tier: DownloadTierPreference,
  jobId?: string,
): Promise<AcquisitionResult> {
  const fetched = await fetchAlbumTracks(album);
  let listing = fetched;
  const seededJob = jobId ? getDownloadJobs().find((j) => j.id === jobId) : undefined;
  if (seededJob && Object.keys(seededJob.tracks).length > listing.length) {
    listing = Object.values(seededJob.tracks).map((t) => ({
      kind: 'track' as const,
      id: t.trackId,
      title: t.title,
      artist: seededJob.artist,
      album: album.title,
    }));
  }
  if (listing.length === 0) {
    throw new Error(`No track listing found for "${album.title}"`);
  }

  const albumName = mode === 'album' ? album.title : undefined;
  const coverage = await resolveCatalogLockerCoverage(album, { listing, albumName });

  if (coverage.fullyInLocker) {
    if (jobId) {
      initJobTracks(
        jobId,
        coverage.listing.map((t) => ({ id: t.id, title: t.title })),
      );
      for (const track of coverage.listing) {
        patchTrackDownload(jobId, track.id, { status: 'skipped', percent: 100 });
      }
      patchDownloadJob(jobId, {
        status: 'done',
        progress: 100,
        completedTracks: coverage.listing.length,
        currentTrack: undefined,
      });
    }
    if (albumName) {
      try {
        await ensureDownloadedAlbumCover({
          albumName,
          albumArtist: album.artist,
          artworkUrl: album.artworkUrl,
          releaseYear: album.releaseYear,
        });
      } catch (err) {
        console.warn('[acquisition] album cover persist failed (already in locker):', err);
      }
    }
    return {
      saved: 0,
      skipped: coverage.listing.length,
      failed: 0,
      errors: [],
    };
  }

  if (coverage.needing.length === 0) {
    const msg =
      coverage.expectedTrackCount > coverage.listing.length
        ? `Only ${coverage.listing.length} of ${coverage.expectedTrackCount} tracks resolved for "${album.title}"`
        : `No tracks to download for "${album.title}"`;
    if (jobId) {
      patchDownloadJob(jobId, { status: 'error', error: msg });
    }
    throw new Error(msg);
  }

  if (jobId) {
    initJobTracks(jobId, coverage.needing);
    patchDownloadJob(jobId, {
      status: 'resolving',
      totalTracks: coverage.needing.length,
      completedTracks: 0,
    });
  }

  return acquireTracksOnServer(coverage.needing, {
    tier,
    mode,
    album,
    albumName: mode === 'album' ? album.title : undefined,
    albumArtist: album.artist,
    releaseYear: album.releaseYear,
    jobId,
  });
}

export async function acquireCatalogTrack(
  track: CatalogTrack,
  tier: DownloadTierPreference,
  jobId?: string,
  _candidates?: CandidateSource[],
): Promise<AcquisitionResult> {
  if (jobId) {
    initJobTracks(jobId, [{ id: track.id, title: track.title }]);
    patchDownloadJob(jobId, { status: 'resolving' });
  }

  return acquireTracksOnServer([track], {
    tier,
    mode: 'tracks',
    jobId,
    albumName: track.album,
    albumArtist: track.artist,
  });
}

export async function acquireSearchHit(
  envelope: MediaEnvelope,
  tier: DownloadTierPreference,
  jobId?: string,
  _candidates?: CandidateSource[],
): Promise<AcquisitionResult> {
  const track: CatalogTrack = {
    kind: 'track',
    id: envelope.envelopeId,
    title: envelope.title,
    artist: envelope.artist,
    album: envelope.album,
    artworkUrl: envelope.artworkUrl,
    releaseYear: envelope.releaseYear,
    durationSeconds: envelope.durationSeconds,
    envelope,
  };
  return acquireCatalogTrack(track, tier, jobId);
}

function failedTrackIds(job: DownloadJob): string[] {
  return Object.values(job.tracks)
    .filter((t) => t.status === 'error')
    .map((t) => t.trackId);
}

/** Re-schedule a persisted queued job that lost its in-memory runner (reload / orphan). */
export function scheduleOrphanQueuedDownloadJob(job: DownloadJob): void {
  patchDownloadJob(job.id, { status: 'queued', error: undefined });
  if (job.mode === 'album' && job.albumTitle) {
    const album: CatalogAlbum = {
      kind: 'album',
      id: job.albumId ?? job.id,
      title: job.albumTitle,
      artist: job.artist,
    };
    scheduleCatalogAlbumDownload(album, job.mode, job.tier, job.id);
    return;
  }
  const track: CatalogTrack = {
    kind: 'track',
    id: `resume-${job.id}`,
    title: job.label,
    artist: job.artist,
    album: job.albumTitle,
  };
  scheduleCatalogTrackDownload(track, job.tier, job.id);
}

/** Attach a runner to a queued job that has no pending runner (avoids drain deadlock). */
export async function resumeOrphanQueuedDownloadJob(jobId: string): Promise<void> {
  if (isDownloadJobAcquiring(jobId)) return;
  const job = getDownloadJobs().find((j) => j.id === jobId);
  if (!job || job.status !== 'queued') return;
  if (isDownloadJobActivelyRunning(job)) return;
  scheduleOrphanQueuedDownloadJob(job);
}

/** Retry all failed tracks in a download job (skips tracks already in locker). */
export async function retryDownloadJob(jobId: string): Promise<void> {
  if (isDownloadJobAcquiring(jobId)) return;
  const live = getDownloadJobs().find((j) => j.id === jobId);
  if (live && isDownloadJobActivelyRunning(live)) return;

  const job = resetDownloadJobForRetry(jobId);
  if (!job) return;

  const needTrackIds = new Set(
    Object.values(job.tracks)
      .filter((t) => t.status !== 'done' && t.status !== 'skipped')
      .map((t) => t.trackId),
  );
  const failed = failedTrackIds(job);
  if (
    needTrackIds.size === 0 &&
    failed.length === 0 &&
    job.status !== 'error' &&
    job.status !== 'paused'
  ) {
    if (Object.keys(job.tracks).length > 0) return;
    scheduleOrphanQueuedDownloadJob(job);
    return;
  }

  patchDownloadJob(jobId, { status: 'queued', error: undefined });

  scheduleDownloadJob(jobId, () => runRetryDownloadJob(jobId));
}

async function runRetryDownloadJob(jobId: string): Promise<void> {
  const job = getDownloadJobs().find((j) => j.id === jobId);
  if (!job) return;

  if (job.mode === 'album' && job.albumTitle) {
    const album: CatalogAlbum = {
      kind: 'album',
      id: job.albumId ?? job.id,
      title: job.albumTitle,
      artist: job.artist,
    };
    const allTracks = await fetchAlbumTracks(album);
    const needTrackIds = new Set(
      Object.values(job.tracks)
        .filter((t) => t.status !== 'done' && t.status !== 'skipped')
        .map((t) => t.trackId),
    );
    const failed = failedTrackIds(job);
    const toRetry =
      needTrackIds.size > 0
        ? allTracks.filter((t) => needTrackIds.has(t.id))
        : failed.length > 0
          ? allTracks.filter((t) => failed.includes(t.id))
          : allTracks;
    if (toRetry.length === 0) {
      const pendingTitles = new Set(
        Object.values(job.tracks)
          .filter((t) => t.status === 'pending' || t.status === 'error')
          .map((t) => t.title.trim().toLowerCase()),
      );
      const byTitle = allTracks.filter((t) => pendingTitles.has(t.title.trim().toLowerCase()));
      if (byTitle.length === 0) {
        patchDownloadJob(jobId, { status: 'error', error: 'No tracks to retry' });
        return;
      }
      await acquireTracksOnServer(byTitle, {
        tier: job.tier,
        mode: job.mode,
        album,
        albumName: job.albumTitle,
        albumArtist: job.artist,
        jobId,
      });
      return;
    }
    await acquireTracksOnServer(toRetry, {
      tier: job.tier,
      mode: job.mode,
      album,
      albumName: job.albumTitle,
      albumArtist: job.artist,
      jobId,
    });
    return;
  }

  const trackStates = Object.values(job.tracks).filter(
    (t) => t.status === 'pending' || t.status === 'error',
  );
  if (trackStates.length === 0 && job.totalTracks > 0) {
    const track: CatalogTrack = {
      kind: 'track',
      id: `resume-${jobId}`,
      title: job.label,
      artist: job.artist,
      album: job.albumTitle,
    };
    try {
      await acquireCatalogTrack(track, job.tier, jobId);
    } catch (err) {
      patchDownloadJob(jobId, { status: 'error', error: String(err) });
    }
    return;
  }
  for (const state of trackStates) {
    const track: CatalogTrack = {
      kind: 'track',
      id: state.trackId,
      title: state.title,
      artist: job.artist,
      album: job.albumTitle,
    };
    try {
      await acquireCatalogTrack(track, job.tier, jobId);
    } catch (err) {
      patchTrackDownload(jobId, state.trackId, {
        status: 'error',
        errorMessage: String(err),
      });
    }
  }
}

let autoResumeInFlight = false;
let autoResumePending = false;

/**
 * After cold start / hollow revalidation: automatically continue paused album downloads
 * from the tracks that are not yet playable in the locker.
 */
export async function autoResumePausedDownloadJobs(options?: {
  force?: boolean;
}): Promise<number> {
  if (autoResumeInFlight) {
    autoResumePending = true;
    return 0;
  }
  const force = options?.force === true;
  if (!force && shouldThrottleAutoResumeScan()) return 0;
  autoResumeInFlight = true;
  try {
    markAutoResumeScan();
    await revalidateDownloadQueueAgainstLocker();
    const { autoQueueIncompleteAlbumDownloads } = await import('./lockerAlbumCompletion');
    const queued = await autoQueueIncompleteAlbumDownloads();
    await reconcilePausedDownloadJobsWithLocker();
    const needing = listDownloadJobsNeedingResume().filter(
      (job) =>
        !isDownloadJobAcquiring(job.id) && canAutoResumeDownloadJob(job),
    );
    let started = 0;
    for (const job of needing.slice(0, 8)) {
      if (isDownloadJobAcquiring(job.id) || isDownloadJobActivelyRunning(job)) continue;
      if (!canAutoResumeDownloadJob(job)) continue;
      recordAutoResumeAttempt(job.id);
      started += 1;
      void retryDownloadJob(job.id).catch((err) => {
        console.warn('[acquisition] auto-resume failed', job.id, err);
      });
    }
    return started + queued;
  } finally {
    autoResumeInFlight = false;
    if (autoResumePending) {
      autoResumePending = false;
      void autoResumePausedDownloadJobs({ force: true });
    }
  }
}

/** Retry a single failed track within an album download job. */
export async function retryTrackInDownloadJob(jobId: string, trackId: string): Promise<void> {
  const job = getDownloadJobs().find((j) => j.id === jobId);
  if (!job) return;

  resetTrackDownloadForRetry(jobId, trackId);
  const state = getDownloadJobs().find((j) => j.id === jobId)?.tracks[trackId];
  if (!state) return;

  const track: CatalogTrack = {
    kind: 'track',
    id: trackId,
    title: state.title,
    artist: job.artist,
    album: job.albumTitle,
  };

  patchDownloadJob(jobId, { status: 'queued', error: undefined });
  scheduleDownloadJob(jobId, async () => {
    try {
      await acquireCatalogTrack(track, job.tier, jobId);
    } catch (err) {
      patchTrackDownload(jobId, trackId, { status: 'error', errorMessage: String(err) });
      patchDownloadJob(jobId, { status: 'error', error: String(err) });
    }
  });
}

/** Queue album acquisition — runs when no other download is active. */
export function scheduleCatalogAlbumDownload(
  album: CatalogAlbum,
  mode: DownloadMode,
  tier: DownloadTierPreference,
  jobId: string,
): void {
  scheduleDownloadJob(jobId, async () => {
    try {
      await acquireCatalogAlbum(album, mode, tier, jobId);
    } catch (err) {
      patchDownloadJob(jobId, { status: 'error', error: String(err) });
    }
  });
}

/** Queue single-track or pseudo-album acquisition. */
export function scheduleCatalogTrackDownload(
  track: CatalogTrack,
  tier: DownloadTierPreference,
  jobId: string,
  albumDownload?: { album: CatalogAlbum; mode: DownloadMode },
): void {
  scheduleDownloadJob(jobId, async () => {
    try {
      if (albumDownload) {
        await acquireCatalogAlbum(albumDownload.album, albumDownload.mode, tier, jobId);
      } else {
        await acquireCatalogTrack(track, tier, jobId);
      }
    } catch (err) {
      patchDownloadJob(jobId, { status: 'error', error: String(err) });
    }
  });
}

/** Queue search-hit acquisition. */
export function scheduleSearchHitDownload(
  envelope: MediaEnvelope,
  tier: DownloadTierPreference,
  jobId: string,
  candidates?: CandidateSource[],
): void {
  scheduleDownloadJob(jobId, async () => {
    try {
      await acquireSearchHit(envelope, tier, jobId, candidates);
    } catch (err) {
      patchDownloadJob(jobId, { status: 'error', error: String(err) });
    }
  });
}
