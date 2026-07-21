/**
 * Register IndexedDB locker blobs with the Android ContentProvider cache for ExoPlayer.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativeExoPlaybackPlugin } from './androidNativePlayback';
import { isBootUiInteractive } from './bootInteractivity';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getLockerAudioBlob } from './lockerStorage';

const NativeExoPlayback = registerPlugin<NativeExoPlaybackPlugin>('NativeExoPlayback');

const CHUNK_BYTES = 512 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/i;

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

  try {
    return await writeBlobToNativeCache(id, blob, mimeType ?? blob.type);
  } catch (err) {
    console.warn('[nativeExoLockerBridge] register from blob failed:', err);
    return null;
  }
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

  let blob: Blob | null = null;
  for (const lockerId of candidates) {
    blob = await getLockerAudioBlob(lockerId);
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

  const lockerId = candidates[0]!;
  try {
    return await writeBlobToNativeCache(lockerId, blob, envelope.mimeType ?? blob.type);
  } catch (err) {
    console.warn('[nativeExoLockerBridge] register locker blob failed:', err);
    return null;
  }
}

export function isNativeExoPlayableUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) || /^content:\/\//i.test(trimmed);
}
