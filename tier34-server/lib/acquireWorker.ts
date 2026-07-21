/**
 * Acquisition job worker — SQLite-backed queue survives restarts.
 */

import { resolveDebridCandidates } from './debridResolve.js';
import { checkAcquireDedup, enrichAcquiredTrack } from './acoustidEnrich.js';
import { enrichAlbumOnSave } from './enrichAlbumOnSave.js';
import { runHealBlobJob, type HealBlobPayload } from './healBlob.js';
import { runStemAnalyzeJob, type StemAnalyzePayload } from './stemWorker.js';
import {
  claimNextJob,
  enqueueJob,
  getJob,
  markJobComplete,
  markJobFailed,
  resetProcessingJobs,
  updateJobPayload,
  type JobRecord,
} from './jobQueue.js';
import { syncAcquireBlob, type SourceOrigin } from './mediaGraph.js';
import {
  blobExists,
  saveBlob,
  sha256HexBuffer,
  upsertManifestEntry,
  type LockerSyncManifestEntry,
} from './lockerStorage.js';
import { proxyStreamUpstream, resolveProxyCandidates } from './proxyResolve.js';
import { searchProxyTier } from './search.js';
import {
  isSoulseekConfigured,
  parseSoulseekUrl,
  readSoulseekDownloadBuffer,
  resolveSoulseekCandidate,
} from './soulseek.js';

export type AcquireTier = 'best' | 'proxy' | 'debrid';

export type AcquireTrackInput = {
  id: string;
  title: string;
  artist: string;
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  durationSeconds?: number;
  artworkUrl?: string;
};

export type AcquireTrackStatus =
  | 'pending'
  | 'resolving'
  | 'downloading'
  | 'enriching'
  | 'done'
  | 'error'
  | 'skipped';

export type AcquireTrackState = {
  trackId: string;
  title: string;
  status: AcquireTrackStatus;
  percent: number;
  errorMessage?: string;
  contentHash?: string;
  lockerId?: string;
  skipReason?: string;
  acoustidScore?: number;
  musicbrainzRecordingId?: string;
};

export type AcquireJobStatus = 'queued' | 'running' | 'metadata' | 'done' | 'error';

export type AcquireJob = {
  id: string;
  status: AcquireJobStatus;
  progress: number;
  currentTrack?: string;
  tier: AcquireTier;
  mode: 'album' | 'tracks';
  albumTitle?: string;
  albumArtist?: string;
  releaseYear?: string;
  artworkUrl?: string;
  trackInputs: AcquireTrackInput[];
  tracks: Record<string, AcquireTrackState>;
  error?: string;
  startedAt: number;
  prowlarrUrl?: string;
  prowlarrApiKey?: string;
  realDebridApiKey?: string;
};

export type AcquireJobPayload = {
  type: 'acquire';
  job: AcquireJob;
};

type ResolveRow = {
  url?: string;
  title?: string;
  artist?: string;
  durationSeconds?: number;
};

let workerRunning = false;
let workerScheduled = false;

function newJobId(): string {
  return `acq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistAcquirePayload(job: AcquireJob): void {
  updateJobPayload(job.id, { type: 'acquire', job } satisfies AcquireJobPayload);
}

export function createAcquireJob(input: {
  tracks: AcquireTrackInput[];
  tier: AcquireTier;
  mode?: 'album' | 'tracks';
  albumTitle?: string;
  albumArtist?: string;
  releaseYear?: string;
  artworkUrl?: string;
  prowlarrUrl?: string;
  prowlarrApiKey?: string;
  realDebridApiKey?: string;
}): AcquireJob {
  const id = newJobId();
  const trackStates: Record<string, AcquireTrackState> = {};
  for (const t of input.tracks) {
    trackStates[t.id] = {
      trackId: t.id,
      title: t.title,
      status: 'pending',
      percent: 0,
    };
  }

  const job: AcquireJob = {
    id,
    status: 'queued',
    progress: 0,
    tier: input.tier,
    mode: input.mode ?? 'tracks',
    albumTitle: input.albumTitle,
    albumArtist: input.albumArtist,
    releaseYear: input.releaseYear,
    artworkUrl: input.artworkUrl,
    trackInputs: input.tracks,
    tracks: trackStates,
    startedAt: Date.now(),
    prowlarrUrl: input.prowlarrUrl,
    prowlarrApiKey: input.prowlarrApiKey,
    realDebridApiKey: input.realDebridApiKey,
  };

  enqueueJob(id, { type: 'acquire', job } satisfies AcquireJobPayload);
  scheduleWorker();
  return job;
}

export function getAcquireJob(jobId: string): AcquireJob | null {
  const record = getJob(jobId);
  if (!record) return null;
  const payload = record.payload as AcquireJobPayload | HealBlobPayload;
  if (payload?.type !== 'acquire') return null;
  return payload.job;
}

/** Boot recovery — reset crashed processing jobs and start worker. */
export function initJobWorker(): number {
  const reset = resetProcessingJobs();
  scheduleWorker();
  return reset;
}

/** Wake worker after enqueueing a job outside createAcquireJob. */
export function kickJobWorker(): void {
  scheduleWorker();
}

function scheduleWorker(): void {
  if (workerScheduled) return;
  workerScheduled = true;
  setImmediate(() => {
    workerScheduled = false;
    void pumpQueue();
  });
}

async function pumpQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (true) {
      const record = claimNextJob();
      if (!record) break;

      const payload = record.payload as { type?: string };
      if (payload?.type === 'heal-blob') {
        await runHealBlobJob(record);
      } else if (payload?.type === 'stem-analyze') {
        const stemPayload = record.payload as StemAnalyzePayload;
        await runStemAnalyzeJob(stemPayload.job);
      } else if (payload?.type === 'acquire') {
        const acquirePayload = record.payload as AcquireJobPayload;
        await runAcquireJob(acquirePayload.job);
      } else {
        markJobFailed(record.jobId, `Unknown job type: ${payload?.type ?? 'missing'}`);
      }
    }
  } finally {
    workerRunning = false;
  }
}

function patchTrack(job: AcquireJob, trackId: string, patch: Partial<AcquireTrackState>): void {
  const existing = job.tracks[trackId];
  if (!existing) return;
  job.tracks[trackId] = { ...existing, ...patch };
}

function recomputeProgress(job: AcquireJob): void {
  const states = Object.values(job.tracks);
  if (states.length === 0) {
    job.progress = 0;
    return;
  }
  let weighted = 0;
  for (const s of states) {
    if (s.status === 'done' || s.status === 'skipped') weighted += 100;
    else if (s.status === 'error') weighted += 0;
    else weighted += s.percent;
  }
  job.progress = Math.min(100, Math.round(weighted / states.length));
}

async function resolveForTier(
  query: string,
  tier: AcquireTier,
  opts: Pick<AcquireJob, 'prowlarrUrl' | 'prowlarrApiKey' | 'realDebridApiKey'>,
): Promise<ResolveRow | null> {
  let rows: ResolveRow[] = [];

  if (tier === 'proxy' || tier === 'best') {
    rows = await resolveProxyCandidates(query);
  }
  if ((tier === 'debrid' || tier === 'best') && rows.length === 0) {
    rows = await resolveDebridCandidates({
      query,
      prowlarrUrl: opts.prowlarrUrl ?? process.env.PROWLARR_URL ?? '',
      prowlarrApiKey: opts.prowlarrApiKey ?? process.env.PROWLARR_API_KEY ?? '',
      realDebridApiKey: opts.realDebridApiKey ?? process.env.REALDEBRID_API_KEY ?? '',
    });
  }
  if (rows.length === 0 && (tier === 'best' || tier === 'debrid') && isSoulseekConfigured()) {
    const soulseek = await resolveSoulseekCandidate(query);
    if (soulseek?.url) rows = [soulseek];
  }
  if (rows.length === 0 && tier === 'best') {
    const fallback = await searchProxyTier(query);
    rows = fallback.map((r) => ({
      url: r.url,
      title: r.title,
      artist: r.artist,
      durationSeconds: r.durationSeconds,
    }));
  }

  return rows.find((r) => r.url?.trim()) ?? null;
}

function extractProxyTarget(url: string): string | null {
  if (url.includes('/api/proxy/stream')) {
    try {
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.get('url');
    } catch {
      return null;
    }
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return null;
}

async function fetchAudioBuffer(url: string): Promise<Buffer> {
  const soulseekRef = parseSoulseekUrl(url);
  if (soulseekRef) {
    return readSoulseekDownloadBuffer(soulseekRef);
  }

  const target = extractProxyTarget(url);
  const upstream = target
    ? await proxyStreamUpstream(target)
    : await fetch(url, {
        headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
      });

  if (!upstream.ok) {
    throw new Error(`Download failed (HTTP ${upstream.status})`);
  }

  const body = upstream.body;
  if (!body) throw new Error('Empty response body');

  const chunks: Buffer[] = [];
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 8_000) {
    throw new Error('Download too small — source may be unavailable');
  }
  const head = buf.subarray(0, 256).toString('utf8');
  if (head.includes('<html') || head.includes('<!DOCTYPE')) {
    throw new Error('Received HTML instead of audio');
  }
  return buf;
}

function lockerIdForTrack(trackId: string, hash: string): string {
  const safe = trackId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return `locker-acq-${safe}-${hash.slice(0, 8)}`;
}

function sourceOriginForTier(tier: AcquireTier): SourceOrigin {
  if (tier === 'debrid') return 'debrid';
  if (tier === 'proxy') return 'youtube';
  return 'proxy';
}

function manifestRowFromEnrichment(
  lockerId: string,
  contentHash: string,
  enrichment: Awaited<ReturnType<typeof enrichAcquiredTrack>>,
  job: AcquireJob,
  track: AcquireTrackInput,
  version: number,
): LockerSyncManifestEntry {
  return {
    id: lockerId,
    contentHash,
    title: enrichment.title,
    artist: job.albumArtist ?? enrichment.artist,
    albumName: job.albumTitle ?? enrichment.albumName ?? track.albumName,
    durationSeconds: enrichment.durationSeconds || track.durationSeconds || 0,
    addedAt: Date.now(),
    remoteBlobUrl: `/api/locker/blob/${contentHash}`,
    releaseYear: enrichment.releaseYear ?? job.releaseYear ?? track.releaseYear,
    acoustidId: enrichment.acoustidId,
    musicbrainzRecordingId: enrichment.musicbrainzRecordingId,
    musicbrainzReleaseId: enrichment.musicbrainzReleaseId,
    musicbrainzReleaseGroupId: enrichment.musicbrainzReleaseGroupId,
    version,
  };
}

function markSkippedDuplicate(
  job: AcquireJob,
  trackId: string,
  dedup: Extract<ReturnType<typeof checkAcquireDedup>, { kind: 'duplicate-hash' | 'duplicate-recording' }>,
  enrichment?: Awaited<ReturnType<typeof enrichAcquiredTrack>>,
): void {
  const reason =
    dedup.kind === 'duplicate-hash'
      ? 'Already in locker (same file)'
      : 'Already in locker (same recording)';
  patchTrack(job, trackId, {
    status: 'skipped',
    percent: 100,
    contentHash: dedup.existing.contentHash,
    lockerId: dedup.existing.id,
    skipReason: reason,
    title: dedup.existing.title,
    acoustidScore: enrichment?.matchScore,
    musicbrainzRecordingId:
      enrichment?.musicbrainzRecordingId ?? dedup.existing.musicbrainzRecordingId,
  });
}

async function runAcquireJob(job: AcquireJob): Promise<void> {
  job.status = 'running';
  persistAcquirePayload(job);

  for (const track of job.trackInputs) {
    if (job.tracks[track.id]?.status === 'done') continue;

    job.currentTrack = track.title;
    patchTrack(job, track.id, { status: 'resolving', percent: 15 });
    recomputeProgress(job);
    persistAcquirePayload(job);

    try {
      const query = `${track.title} ${track.artist}`.trim();
      const hit = await resolveForTier(query, job.tier, job);
      if (!hit?.url?.trim()) {
        throw new Error(`No source for "${track.title}"`);
      }

      patchTrack(job, track.id, { status: 'downloading', percent: 55 });
      recomputeProgress(job);
      persistAcquirePayload(job);

      const audioBuf = await fetchAudioBuffer(hit.url);
      const contentHash = sha256HexBuffer(audioBuf);

      const hashDedup = checkAcquireDedup(contentHash);
      if (hashDedup.kind !== 'new') {
        markSkippedDuplicate(job, track.id, hashDedup);
        recomputeProgress(job);
        persistAcquirePayload(job);
        continue;
      }

      patchTrack(job, track.id, { status: 'enriching', percent: 72 });
      recomputeProgress(job);
      persistAcquirePayload(job);

      const enrichment = await enrichAcquiredTrack(audioBuf, {
        title: track.title,
        artist: track.artist,
        albumName: job.albumTitle ?? track.albumName,
        albumArtist: job.albumArtist,
        releaseYear: job.releaseYear ?? track.releaseYear,
        durationSeconds: track.durationSeconds ?? hit.durationSeconds,
      });

      const recordingDedup = checkAcquireDedup(contentHash, enrichment.musicbrainzRecordingId);
      if (recordingDedup.kind !== 'new') {
        markSkippedDuplicate(job, track.id, recordingDedup, enrichment);
        recomputeProgress(job);
        persistAcquirePayload(job);
        continue;
      }

      if (!blobExists(contentHash)) {
        saveBlob(contentHash, audioBuf);
      }

      const lockerId = lockerIdForTrack(track.id, contentHash);
      const origin = sourceOriginForTier(job.tier);
      const manifestRow = manifestRowFromEnrichment(
        lockerId,
        contentHash,
        enrichment,
        job,
        track,
        1,
      );

      try {
        syncAcquireBlob(lockerId, contentHash, audioBuf.length, origin, hit.url, {
          title: manifestRow.title,
          artist: manifestRow.artist,
          albumName: manifestRow.albumName,
          durationSeconds: manifestRow.durationSeconds,
          releaseYear: manifestRow.releaseYear,
          musicbrainzReleaseId: manifestRow.musicbrainzReleaseId,
          musicbrainzReleaseGroupId: manifestRow.musicbrainzReleaseGroupId,
          version: 1,
        });
      } catch {
        /* graph best-effort */
      }

      upsertManifestEntry(manifestRow);

      patchTrack(job, track.id, {
        status: 'done',
        percent: 100,
        title: enrichment.title,
        contentHash,
        lockerId,
        acoustidScore: enrichment.matchScore > 0 ? enrichment.matchScore : undefined,
        musicbrainzRecordingId: enrichment.musicbrainzRecordingId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchTrack(job, track.id, { status: 'error', percent: 0, errorMessage: msg });
    }

    recomputeProgress(job);
    persistAcquirePayload(job);
  }

  const doneCount = Object.values(job.tracks).filter(
    (t) => t.status === 'done' || t.status === 'skipped',
  ).length;

  if (job.mode === 'album' && job.albumTitle && doneCount > 0) {
    job.status = 'metadata';
    job.currentTrack = undefined;
    persistAcquirePayload(job);
    try {
      const enriched = await enrichAlbumOnSave({
        title: job.albumTitle,
        artist: job.albumArtist ?? job.trackInputs[0]?.artist ?? '',
        albumName: job.albumTitle,
        albumArtist: job.albumArtist,
        releaseYear: job.releaseYear,
      });

      if (enriched.coverArtBytes && enriched.coverHash) {
        try {
          saveBlob(enriched.coverHash, enriched.coverArtBytes);
        } catch {
          /* cover optional */
        }
      }

      for (const state of Object.values(job.tracks)) {
        if (state.status !== 'done' || !state.lockerId || !state.contentHash) continue;
        try {
          syncAcquireBlob(state.lockerId, state.contentHash, 0, sourceOriginForTier(job.tier), undefined, {
            title: state.title,
            artist: job.albumArtist ?? state.title,
            albumName: job.albumTitle,
            musicbrainzReleaseId: enriched.musicbrainzReleaseId || undefined,
            musicbrainzReleaseGroupId: enriched.musicbrainzReleaseGroupId || undefined,
            coverHash: enriched.coverHash,
            releaseYear: enriched.releaseYear ?? job.releaseYear,
            creditsJson: enriched.creditsJson,
            version: 2,
          });
        } catch {
          /* graph best-effort */
        }
        upsertManifestEntry({
          id: state.lockerId,
          contentHash: state.contentHash,
          title: state.title,
          artist: job.albumArtist ?? state.title,
          albumName: job.albumTitle,
          durationSeconds: 0,
          addedAt: Date.now(),
          remoteBlobUrl: `/api/locker/blob/${state.contentHash}`,
          releaseYear: enriched.releaseYear ?? job.releaseYear,
          coverHash: enriched.coverHash,
          musicbrainzReleaseId: enriched.musicbrainzReleaseId || undefined,
          musicbrainzReleaseGroupId: enriched.musicbrainzReleaseGroupId || undefined,
          musicbrainzRecordingId: state.musicbrainzRecordingId,
          creditsJson: enriched.creditsJson,
          version: 2,
        });
      }
    } catch {
      /* metadata best-effort */
    }
  }

  const errors = Object.values(job.tracks).filter((t) => t.status === 'error');
  job.status = errors.length === job.trackInputs.length ? 'error' : 'done';
  job.progress = 100;
  job.currentTrack = undefined;
  if (errors.length > 0 && doneCount === 0) {
    job.error = errors[0].errorMessage;
  } else if (errors.length > 0) {
    job.error = `${errors.length} track(s) failed — ${errors[0].errorMessage ?? 'unknown'}`;
  }

  persistAcquirePayload(job);
  if (job.status === 'error') {
    markJobFailed(job.id, job.error ?? 'acquire failed', false);
  } else {
    markJobComplete(job.id, { status: job.status, progress: job.progress, tracks: job.tracks });
  }
}
