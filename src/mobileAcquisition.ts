/**
 * On-device catalog acquisition — yt-dlp resolve + IndexedDB locker when Sandbox Server is offline.
 */

import { Capacitor } from '@capacitor/core';
import type { MediaEnvelope } from './sandboxLayer1';
import type { DownloadMode } from './downloadQueue';
import {
  ensureJobTrack,
  patchDownloadJob,
  patchTrackDownload,
} from './downloadQueue';
import { buildPlayQueries } from './hybridResolution';
import { hasActiveMobileResolvers } from './mobileResolverRegistry';
import { isAndroid } from './platformEnv';
import {
  findLockerEntryForTrackIncludingHollow,
  findPlayableLockerEntryForTrack,
  getLockerEntriesSnapshot,
  persistOrphanTrackCover,
  resolveLockerReacquireTargetId,
  saveLockerBlob,
  saveLockerBlobFromNativeFile,
  type MobileAudioSource,
} from './lockerStorage';
import { findAlbumCover } from './albumCover';
import { ensureDownloadedAlbumCover } from './lockerAlbumBackfill';
import { fetchWithTimeout } from './fetchWithTimeout';
import { downloadViaYtDlpMobile, waitForYtDlpInit } from './ytDlpMobile';
import type { CatalogTrack } from './searchCatalog';
import { yieldToMain } from './yieldToMain';
import {
  DOWNLOAD_BATTERY_PAUSE_MESSAGE,
  shouldPauseDownloadsForBattery,
} from './downloadBatteryGate';

export type MobileAcquisitionResult = {
  saved: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const AUDIO_FETCH_TIMEOUT_MS = 180_000;

export function canAcquireOnMobile(): boolean {
  return isAndroid() && hasActiveMobileResolvers();
}

async function fetchAudioBlobFromUri(uri: string): Promise<Blob> {
  const trimmed = uri.trim();
  if (!trimmed) throw new Error('empty audio uri');

  if (/^file:\/\//i.test(trimmed)) {
    const path = decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    const webUrl = Capacitor.convertFileSrc(path);
    const res = await fetch(webUrl);
    if (!res.ok) throw new Error(`local audio read failed (${res.status})`);
    const blob = await res.blob();
    if (blob.size <= 0) throw new Error('empty local audio file');
    return blob;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetchWithTimeout(trimmed, undefined, AUDIO_FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`audio fetch HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size <= 0) throw new Error('empty audio response');
    return blob;
  }

  throw new Error(`unsupported audio uri scheme: ${trimmed.slice(0, 48)}`);
}

function formatToMimeType(format: string): string | undefined {
  const f = format.toLowerCase();
  if (f.includes('mp3') || f.includes('mpeg')) return 'audio/mpeg';
  if (f.includes('flac')) return 'audio/flac';
  if (f.includes('ogg')) return 'audio/ogg';
  if (f.includes('wav')) return 'audio/wav';
  if (f.includes('m4a') || f.includes('aac') || f.includes('mp4')) return 'audio/mp4';
  if (f.includes('webm')) return 'audio/webm';
  if (f.includes('opus')) return 'audio/opus';
  return undefined;
}

function trackEnvelope(track: CatalogTrack, albumName?: string): MediaEnvelope {
  if (track.envelope) {
    return {
      ...track.envelope,
      album: albumName ?? track.envelope.album ?? track.album,
    };
  }
  return {
    envelopeId: track.id,
    title: track.title,
    artist: track.artist,
    album: albumName ?? track.album,
    url: '',
    durationSeconds: track.durationSeconds ?? 0,
    provider: 'https',
    transport: 'element-src',
    sourceId: track.id,
    artworkUrl: track.artworkUrl,
    releaseYear: track.releaseYear,
  };
}

async function resolveTrackAudioSource(
  track: CatalogTrack,
  albumName?: string,
): Promise<MobileAudioSource> {
  const env = trackEnvelope(track, albumName);
  const queries = buildPlayQueries(env);
  const ready = await waitForYtDlpInit();
  if (!ready) throw new Error('yt-dlp mobile not ready');

  let lastErr = 'no mobile source';
  for (const query of queries) {
    await yieldToMain();
    const hit = await downloadViaYtDlpMobile(query);
    if (!hit?.uri?.trim()) continue;
    const uri = hit.uri.trim();
    if (isAndroid() && /^file:\/\//i.test(uri)) {
      return { kind: 'file', uri, mimeType: formatToMimeType(hit.format) };
    }
    try {
      const blob = await fetchAudioBlobFromUri(uri);
      return { kind: 'blob', blob };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn('[mobileAcquisition] fetch failed', { query, err: lastErr });
    }
  }
  throw new Error(`No mobile source for "${track.title}" — ${lastErr}`);
}

async function lockerHasTrack(
  title: string,
  artist: string,
  albumName?: string,
): Promise<boolean> {
  return Boolean(await findPlayableLockerEntryForTrack(title, artist, albumName));
}

async function persistCoverForTrack(
  entryId: string,
  track: CatalogTrack,
  albumName?: string,
  albumArtist?: string,
): Promise<void> {
  const artUrl = track.artworkUrl?.trim();
  if (albumName) {
    await ensureDownloadedAlbumCover({
      albumName,
      albumArtist,
      artworkUrl: artUrl,
      releaseYear: track.releaseYear,
    });
    return;
  }

  if (artUrl) {
    await persistOrphanTrackCover(entryId, artUrl, { releaseYear: track.releaseYear });
    return;
  }

  const album = track.album?.trim();
  if (album) {
    const cover = await findAlbumCover(album, track.artist);
    if (cover?.url) {
      await persistOrphanTrackCover(entryId, cover.url, { releaseYear: cover.year ?? track.releaseYear });
    }
  }
}

export async function acquireTracksOnMobile(
  tracks: CatalogTrack[],
  options: {
    mode: DownloadMode;
    albumName?: string;
    albumArtist?: string;
    releaseYear?: string;
    artworkUrl?: string;
    jobId?: string;
  },
): Promise<MobileAcquisitionResult> {
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  if (!canAcquireOnMobile()) {
    throw new Error('Mobile acquisition requires Android with yt-dlp mobile enabled.');
  }

  const albumName = options.albumName?.trim() || undefined;
  const total = tracks.length;

  if (options.jobId) {
    patchDownloadJob(options.jobId, { status: 'resolving', totalTracks: total });
  }

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    await yieldToMain();

    if (await shouldPauseDownloadsForBattery()) {
      if (options.jobId) {
        patchDownloadJob(options.jobId, {
          status: 'paused',
          error: DOWNLOAD_BATTERY_PAUSE_MESSAGE,
          currentTrack: undefined,
        });
      }
      return { saved, skipped, failed, errors };
    }

    if (options.jobId) {
      ensureJobTrack(options.jobId, { id: track.id, title: track.title });
      patchDownloadJob(options.jobId, {
        currentTrack: track.title,
        progress: Math.round((i / Math.max(1, total)) * 100),
      });
      patchTrackDownload(options.jobId, track.id, { status: 'resolving', percent: 5 });
    }

    if (await lockerHasTrack(track.title, track.artist, albumName)) {
      skipped += 1;
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, { status: 'skipped', percent: 100 });
        patchDownloadJob(options.jobId, {
          completedTracks: i + 1,
          progress: Math.round(((i + 1) / total) * 100),
        });
      }
      continue;
    }

    try {
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, { status: 'downloading', percent: 20 });
      }
      const source = await resolveTrackAudioSource(track, albumName);
      await yieldToMain();
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, { status: 'downloading', percent: 85 });
      }

      const meta = {
        title: track.title,
        artist: track.artist,
        albumName,
        albumArtist: options.albumArtist,
        releaseYear: options.releaseYear ?? track.releaseYear,
        durationSeconds: track.durationSeconds,
        trackNumber: track.trackNumber ?? (albumName ? i + 1 : undefined),
        discNumber: track.discNumber,
        skipHeavyAnalysis: true,
        replaceEntryId: await resolveLockerReacquireTargetId(
          track.title,
          track.artist,
          albumName,
        ),
      };

      let entry;
      let byteCount = 0;
      if (source.kind === 'file') {
        const saved = await saveLockerBlobFromNativeFile(source.uri, {
          ...meta,
          mimeType: source.mimeType,
        });
        entry = saved.entry;
        byteCount = saved.bytes;
      } else {
        entry = await saveLockerBlob(source.blob, meta);
        byteCount = source.blob.size;
      }

      void persistCoverForTrack(entry.id, track, albumName, options.albumArtist).catch((err) => {
        console.warn('[mobileAcquisition] cover persist failed:', err);
      });

      saved += 1;
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, { status: 'done', percent: 100 });
        patchDownloadJob(options.jobId, {
          completedTracks: i + 1,
          progress: Math.round(((i + 1) / total) * 100),
        });
      }
      console.log(
        `[SandboxE2E] AREA=download-track RESULT=PASS title=${track.title} artist=${track.artist} album=${albumName ?? 'single'} bytes=${byteCount} native=${source.kind === 'file'}`,
      );
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${track.title}: ${msg}`);
      if (options.jobId) {
        patchTrackDownload(options.jobId, track.id, {
          status: 'error',
          percent: 0,
          errorMessage: msg,
        });
      }
      console.error(
        `[SandboxE2E] AREA=download-track RESULT=FAIL title=${track.title} artist=${track.artist} error=${msg}`,
      );
    }
  }

  if (albumName) {
    const catalogArt =
      options.artworkUrl?.trim() || tracks.find((t) => t.artworkUrl?.trim())?.artworkUrl?.trim();
    try {
      await ensureDownloadedAlbumCover({
        albumName,
        albumArtist: options.albumArtist,
        artworkUrl: catalogArt,
        releaseYear: options.releaseYear,
      });
    } catch (err) {
      console.warn('[mobileAcquisition] album cover persist failed:', err);
    }
  }

  if (options.jobId) {
    patchDownloadJob(options.jobId, {
      status: failed === total && saved === 0 && skipped === 0 ? 'error' : 'done',
      progress: 100,
      currentTrack: undefined,
      error:
        failed > 0
          ? `${failed} track(s) failed — ${errors[0] ?? 'unknown'}`
          : undefined,
    });
  }

  return { saved, skipped, failed, errors };
}

/** E2E / automation — confirm locker entry exists for title+artist (+ optional album). */
export async function verifyLockerEntry(
  title: string,
  artist: string,
  albumName?: string,
): Promise<{ ok: boolean; entryId?: string; albumName?: string }> {
  const snapshot = getLockerEntriesSnapshot();
  const entry = await findPlayableLockerEntryForTrack(title, artist, albumName, snapshot);
  if (entry) {
    return { ok: true, entryId: entry.id, albumName: entry.albumName };
  }
  if (isAndroid()) {
    const hollow = findLockerEntryForTrackIncludingHollow(
      title,
      artist,
      albumName,
      snapshot ?? undefined,
    );
    if (hollow) {
      const { healLockerEntryNativePlayback } = await import('./lockerStorage');
      const uri = await healLockerEntryNativePlayback(hollow.id);
      if (uri) {
        return { ok: true, entryId: hollow.id, albumName: hollow.albumName };
      }
    }
  }
  return { ok: false };
}
