/**
 * Register IndexedDB locker blobs with the Android ContentProvider cache for ExoPlayer.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { Capacitor } from '@capacitor/core';
import { NativeExoPlayback } from './nativePluginHandles';
import { isBootUiInteractive } from './bootInteractivity';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getLockerAudioBlob } from './lockerStorage';

const CHUNK_BYTES = 512 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/i;

// Native beginLockerBlob() unconditionally aborts+restarts any in-progress write for the same
// id (LockerBlobRegistry.beginWrite -> abortWrite). Two independent callers registering the
// same track concurrently (e.g. background prefetch vs. a direct play-now resolve, or a
// post-download cache warm vs. playback) are NOT serialized against each other on the JS side,
// so the second beginWrite can reset the native writer mid-stream while the first call's
// still-in-flight chunk-append calls land on the new writer — producing a scrambled file whose
// bytes belong to neither track's real content. Every write path shares this map, keyed by the
// final on-disk locker id, so concurrent callers for the same track await one write instead of
// racing.
const pendingRegistrations = new Map<string, Promise<string | null>>();

function dedupeLockerWrite(
  id: string,
  run: () => Promise<string | null>,
): Promise<string | null> {
  const inFlight = pendingRegistrations.get(id);
  if (inFlight) return inFlight;
  const task = run().finally(() => {
    pendingRegistrations.delete(id);
  });
  pendingRegistrations.set(id, task);
  return task;
}

export function lockerIdFromEnvelope(envelope: MediaEnvelope): string | null {
  if (envelope.sourceId?.trim()) {
    return envelope.sourceId.trim().replace(/^local-/, '');
  }
  const fromEnv = envelope.envelopeId?.replace(/^local-/, '') ?? '';
  if (fromEnv && !HASH_RE.test(fromEnv)) return fromEnv;
  return fromEnv || null;
}

function blobToBase64Chunk(buffer: ArrayBuffer, offset: number, length: number): string {
  const view = new Uint8Array(buffer, offset, length);
  let binary = '';
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary);
}

async function writeBlobToNativeCache(
  id: string,
  blob: Blob,
  mimeType?: string,
): Promise<string> {
  const buffer = await blob.arrayBuffer();
  await NativeExoPlayback.beginLockerBlob({ id, mimeType: mimeType ?? blob.type ?? undefined });
  try {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const len = Math.min(CHUNK_BYTES, buffer.byteLength - offset);
      const chunk = blobToBase64Chunk(buffer, offset, len);
      await NativeExoPlayback.appendLockerBlobChunk({ id, chunkBase64: chunk });
      offset += len;
      if (offset < buffer.byteLength) {
        const { yieldToMain } = await import('./yieldToMain');
        await yieldToMain();
      }
    }
    const result = await NativeExoPlayback.finishLockerBlob({ id });
    if (!result.contentUri?.trim()) {
      throw new Error('Native locker bridge returned no content URI.');
    }
    return result.contentUri.trim();
  } catch (err) {
    try {
      await NativeExoPlayback.abortLockerBlob({ id });
    } catch {
      /* cleanup best-effort */
    }
    throw err;
  }
}

function lockerIdCandidates(envelope: MediaEnvelope): string[] {
  const ids = new Set<string>();
  const primary = lockerIdFromEnvelope(envelope);
  if (primary) ids.add(primary);
  const source = envelope.sourceId?.trim().replace(/^local-/, '');
  if (source) ids.add(source);
  const fromEnv = envelope.envelopeId?.replace(/^local-/, '') ?? '';
  if (fromEnv && !HASH_RE.test(fromEnv)) ids.add(fromEnv);
  return [...ids];
}

async function cachedNativeLockerUri(lockerId: string): Promise<string | null> {
  if (!isBootUiInteractive()) return null;
  try {
    const existing = await NativeExoPlayback.getLockerBlobUri({ id: lockerId });
    if (existing.contentUri?.trim()) return existing.contentUri.trim();
  } catch {
    /* probe optional */
  }
  return null;
}

/** True when Exo already has a content:// URI for this locker id (IDB blob optional). */
export async function probeNativeLockerContentUri(lockerId: string): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const id = lockerId.trim().replace(/^local-/, '');
  if (!id) return null;
  return cachedNativeLockerUri(id);
}

/** Register a on-disk file (file:// from yt-dlp) without loading audio into JS. */
/**
 * Size on disk of a natively cached locker track, or 0 when there is nothing there.
 *
 * Downloaded tracks live in the native cache rather than an IndexedDB blob, so the web layer has
 * no bytes to measure and the bitrate backfill had nothing to work with for exactly the tracks a
 * listener owns.
 */
export async function nativeLockerBlobBytes(lockerId: string): Promise<number> {
  if (Capacitor.getPlatform() !== 'android') return 0;
  const id = lockerId.trim().replace(/^local-/, '');
  if (!id) return 0;
  try {
    const result = await NativeExoPlayback.getLockerBlobBytes({ id });
    const bytes = typeof result?.bytes === 'number' ? result.bytes : 0;
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  } catch {
    return 0;
  }
}

/**
 * First bytes of a natively cached locker track, or null when there is nothing to read.
 *
 * Container headers live at the front of the file — FLAC STREAMINFO is mandatory and comes first —
 * so a few kilobytes answer what the whole file would, without copying an album across the bridge.
 */
export async function nativeLockerBlobHead(
  lockerId: string,
  bytes = 8_192,
  offset = 0,
): Promise<Uint8Array | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const id = lockerId.trim().replace(/^local-/, '');
  if (!id) return null;
  try {
    const result = await NativeExoPlayback.getLockerBlobHead({ id, bytes, offset });
    const base64 = result?.base64?.trim() ?? '';
    if (!base64) return null;
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function registerLockerBlobFromFileUri(
  lockerId: string,
  fileUri: string,
  mimeType?: string,
): Promise<{ contentUri: string; bytes: number } | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const id = lockerId.trim().replace(/^local-/, '');
  if (!id || !fileUri.trim()) return null;

  const cached = await cachedNativeLockerUri(id);
  if (cached) return { contentUri: cached, bytes: 0 };

  try {
    const result = await NativeExoPlayback.importLockerBlobFromPath({
      id,
      sourcePath: fileUri.trim(),
      mimeType: mimeType ?? undefined,
    });
    const contentUri = result.contentUri?.trim();
    if (!contentUri) return null;
    return { contentUri, bytes: typeof result.bytes === 'number' ? result.bytes : 0 };
  } catch (err) {
    console.warn('[nativeExoLockerBridge] import from file failed:', err);
    return null;
  }
}

/** Register a blob already in memory (e.g. right after locker save). */
export async function registerLockerBlobFromBlob(
  lockerId: string,
  blob: Blob,
  mimeType?: string,
): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  const id = lockerId.trim().replace(/^local-/, '');
  if (!id) return null;

  const cached = await cachedNativeLockerUri(id);
  if (cached) return cached;

  return dedupeLockerWrite(id, async () => {
    const alreadyCached = await cachedNativeLockerUri(id);
    if (alreadyCached) return alreadyCached;
    try {
      return await writeBlobToNativeCache(id, blob, mimeType ?? blob.type);
    } catch (err) {
      console.warn('[nativeExoLockerBridge] register from blob failed:', err);
      return null;
    }
  });
}

/**
 * Copy a locker IndexedDB blob into native cache and return a content:// URI for ExoPlayer.
 */
export async function registerLockerBlobContentUri(
  envelope: MediaEnvelope,
): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'android') return null;

  const candidates = lockerIdCandidates(envelope);
  if (candidates.length === 0) return null;

  for (const lockerId of candidates) {
    const cached = await cachedNativeLockerUri(lockerId);
    if (cached) return cached;
  }

  // The eventual write always targets candidates[0] (see below) — lock on that id so a
  // concurrent registration for the same track (from another caller entirely, e.g.
  // registerLockerBlobFromBlob warming the cache right after a download) shares this write
  // instead of racing it.
  const lockerId = candidates[0]!;
  return dedupeLockerWrite(lockerId, async () => {
    const alreadyCached = await cachedNativeLockerUri(lockerId);
    if (alreadyCached) return alreadyCached;

    let blob: Blob | null = null;
    for (const candidate of candidates) {
      blob = await getLockerAudioBlob(candidate);
      if (blob) break;
    }
    if (!blob && envelope.url?.startsWith('blob:')) {
      try {
        const res = await fetchWithTimeout(envelope.url, undefined, 60_000);
        if (res.ok) blob = await res.blob();
      } catch {
        /* fall through */
      }
    }
    if (!blob) {
      console.warn('[nativeExoLockerBridge] no locker audio blob for', candidates.join(', '));
      return null;
    }

    try {
      return await writeBlobToNativeCache(lockerId, blob, envelope.mimeType ?? blob.type);
    } catch (err) {
      console.warn('[nativeExoLockerBridge] register locker blob failed:', err);
      return null;
    }
  });
}

export function isNativeExoPlayableUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) || /^content:\/\//i.test(trimmed);
}
