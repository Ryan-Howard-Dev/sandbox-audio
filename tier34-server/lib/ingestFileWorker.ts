/**
 * Process ingest-file jobs — hash, dedup, blob store, manifest + graph sync.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  claimNextJobByType,
  enqueueJob,
  markJobComplete,
  markJobFailed,
  type JobRecord,
} from './jobQueue.js';
import { enrichAlbumOnSave } from './enrichAlbumOnSave.js';
import { hashExists, syncManifestEntry, upsertHash } from './mediaGraph.js';
import {
  blobPathForHash,
  saveBlob,
  sha256HexFile,
  upsertManifestEntry,
  type LockerSyncManifestEntry,
} from './lockerStorage.js';
import { scheduleReindex } from './meilisearchIndexer.js';
import { recordIngestOutcome } from './ingestionWatcher.js';
import { readAudioTags } from './readAudioTags.js';

const AUDIO_EXT_RE = /\.(mp3|flac|ogg|wav|m4a|opus|aac|webm)$/i;

export type IngestFilePayload = {
  type: 'ingest-file';
  filePath: string;
};

let ingestActive = 0;
const MAX_INGEST_CONCURRENT = 2;
let ingestPumpScheduled = false;

export function enqueueIngestFileJob(filePath: string): string {
  const jobId = `ingest-${crypto.randomBytes(6).toString('hex')}-${Date.now()}`;
  enqueueJob(jobId, { type: 'ingest-file', filePath } satisfies IngestFilePayload);
  scheduleIngestPump();
  return jobId;
}

export function scheduleIngestPump(): void {
  if (ingestPumpScheduled) return;
  ingestPumpScheduled = true;
  setImmediate(() => {
    ingestPumpScheduled = false;
    void pumpIngestQueue();
  });
}

async function pumpIngestQueue(): Promise<void> {
  while (ingestActive < MAX_INGEST_CONCURRENT) {
    const record = claimNextJobByType('ingest-file');
    if (!record) break;
    ingestActive++;
    void runIngestFileJob(record)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        markJobFailed(record.jobId, msg);
      })
      .finally(() => {
        ingestActive--;
        scheduleIngestPump();
      });
  }
}

function parseTrackFilename(filename: string): { title: string; artist?: string } {
  const base = path.basename(filename).replace(/\.[^/.]+$/, '');
  const withoutNumber = base.replace(/^\s*\d+\s*[-._)]?\s*/, '').trim() || base.trim();
  const dash = withoutNumber.split(/\s+[-–—]\s+/);
  if (dash.length >= 2 && dash[0].trim()) {
    return { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() };
  }
  return { title: withoutNumber };
}

function parseAlbumFolderName(folderName: string): { album?: string; artist?: string; year?: string } {
  const trimmed = folderName.trim();
  const yearMatch = trimmed.match(/\((\d{4})\)\s*$/);
  const year = yearMatch?.[1];
  const withoutYear = year ? trimmed.replace(/\(\d{4}\)\s*$/, '').trim() : trimmed;
  const dash = withoutYear.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    return { artist: dash[0].trim(), album: dash.slice(1).join(' - ').trim(), year };
  }
  return { album: withoutYear, year };
}

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXT_RE.test(filePath);
}

async function copyFileToBlob(hash: string, sourcePath: string): Promise<number> {
  const dest = blobPathForHash(hash);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    await fs.promises.copyFile(sourcePath, dest);
  }
  const stat = await fs.promises.stat(dest);
  return stat.size;
}

export async function runIngestFileJob(record: JobRecord): Promise<void> {
  const payload = record.payload as IngestFilePayload;
  const filePath = payload?.filePath?.trim();
  if (!filePath || !isAudioFile(filePath)) {
    markJobComplete(record.jobId, { skipped: true, reason: 'not-audio' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    markJobComplete(record.jobId, { skipped: true, reason: 'missing' });
    return;
  }

  const contentHash = await sha256HexFile(filePath);

  if (hashExists(contentHash)) {
    recordIngestOutcome(true);
    markJobComplete(record.jobId, { skipped: true, reason: 'hash-exists', contentHash });
    return;
  }

  const bytes = await copyFileToBlob(contentHash, filePath);
  upsertHash(contentHash, bytes);

  const tags = await readAudioTags(filePath);
  const parsed = parseTrackFilename(filePath);
  const parentDir = path.basename(path.dirname(filePath));
  const albumParsed = parseAlbumFolderName(parentDir);
  const artist =
    tags.artist ?? tags.albumArtist ?? parsed.artist ?? albumParsed.artist ?? 'Local Import';
  const albumName = tags.album ?? albumParsed.album;
  const title = tags.title ?? (parsed.title || path.basename(filePath));
  const durationSeconds = tags.durationSeconds ?? 0;
  const releaseYear = tags.releaseYear ?? albumParsed.year;

  const envelopeId = tags.musicbrainzRecordingId
    ? `mb-${tags.musicbrainzRecordingId}`
    : `import-${contentHash.slice(0, 16)}`;

  let enriched: Awaited<ReturnType<typeof enrichAlbumOnSave>> = {
    musicbrainzReleaseId: tags.musicbrainzReleaseId ?? '',
    musicbrainzReleaseGroupId: tags.musicbrainzReleaseGroupId,
    releaseYear,
  };
  if (albumName && !tags.musicbrainzReleaseId) {
    try {
      enriched = await enrichAlbumOnSave({
        title,
        artist,
        albumName,
        albumArtist: tags.albumArtist ?? artist,
        releaseYear,
        durationSeconds,
      });
      if (enriched.coverArtBytes && enriched.coverHash) {
        try {
          saveBlob(enriched.coverHash, enriched.coverArtBytes);
        } catch {
          /* cover optional */
        }
      }
    } catch {
      /* enrichment best-effort */
    }
  }

  const entry: LockerSyncManifestEntry = {
    id: envelopeId,
    contentHash,
    title,
    artist,
    albumName,
    durationSeconds,
    addedAt: Date.now(),
    remoteBlobUrl: `/api/locker/blob/${contentHash}`,
    releaseYear: enriched.releaseYear ?? releaseYear,
    coverHash: enriched.coverHash,
    musicbrainzReleaseId: enriched.musicbrainzReleaseId || undefined,
    musicbrainzReleaseGroupId: enriched.musicbrainzReleaseGroupId,
    creditsJson: enriched.creditsJson,
    version: 1,
  };

  upsertManifestEntry(entry);
  try {
    syncManifestEntry(entry, 'local-import');
  } catch {
    /* graph best-effort */
  }
  scheduleReindex();
  recordIngestOutcome(false);

  markJobComplete(record.jobId, {
    ingested: true,
    envelopeId,
    contentHash,
    bytes,
    title,
    artist,
    albumName,
  });
}

/** Boot recovery — start ingest pump for any pending ingest-file jobs. */
export function initIngestPump(): void {
  scheduleIngestPump();
}
