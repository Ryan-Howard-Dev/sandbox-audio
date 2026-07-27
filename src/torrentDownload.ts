/**
 * Download a file named by a torrent, over its web seed, verifying against the published hashes.
 *
 * The second half of the archive.org torrent path. `torrentMeta` reads the manifest; this fetches
 * the bytes and checks them. No swarm is involved: BEP-19 web seeds are ordinary HTTPS URLs, so
 * this is a GET plus SHA-1, and the value over a plain download is that a corrupted or truncated
 * transfer is *detected* rather than written into the locker as a broken file.
 *
 * Verification is deliberately partial, and says so. A torrent's pieces are laid over the
 * concatenation of all its files, so the first and last piece of a file usually contain bytes
 * belonging to its neighbours and cannot be checked without fetching those too. Only pieces lying
 * wholly inside the file are verified, and the count is reported so a caller can say "verified
 * 412 of 414 pieces" instead of implying more than was actually checked.
 */

import { isAirGapEnabled } from './airGapMode';
import {
  archiveOrgTorrentUrl,
  parseTorrent,
  webSeedUrlFor,
  type TorrentFile,
  type TorrentMeta,
} from './torrentMeta';

export interface PieceSlice {
  pieceIndex: number;
  /** Where this piece begins within the file's own bytes. */
  offsetInFile: number;
  length: number;
}

export interface VerifiedDownload {
  bytes: Uint8Array;
  /** Pieces checked against a published hash. */
  verifiedPieces: number;
  /** Pieces lying wholly inside this file — the most that could have been checked. */
  checkablePieces: number;
}

export type TorrentDownloadFailure =
  | 'no-web-seed'
  | 'fetch-failed'
  | 'length-mismatch'
  | 'hash-mismatch';

export interface TorrentDownloadResult {
  file?: VerifiedDownload;
  reason?: TorrentDownloadFailure;
}

/**
 * Pieces lying wholly inside a file, so each can be hashed from that file's bytes alone.
 *
 * Boundary pieces are excluded rather than guessed at: a piece straddling two files hashes the
 * concatenation of both, so checking it against only one file's bytes would fail for a file that
 * is perfectly intact.
 */
export function piecesFullyInsideFile(meta: TorrentMeta, file: TorrentFile): PieceSlice[] {
  if (meta.pieceLength <= 0) return [];
  const fileEnd = file.offset + file.length;
  const out: PieceSlice[] = [];
  const firstPiece = Math.floor(file.offset / meta.pieceLength);

  for (let index = firstPiece; index < meta.pieceHashes.length; index++) {
    const pieceStart = index * meta.pieceLength;
    if (pieceStart >= fileEnd) break;
    // The final piece of a torrent is short; clamp so it is not treated as running past the end.
    const pieceEnd = Math.min(pieceStart + meta.pieceLength, meta.totalLength);
    if (pieceStart < file.offset || pieceEnd > fileEnd) continue;
    out.push({
      pieceIndex: index,
      offsetInFile: pieceStart - file.offset,
      length: pieceEnd - pieceStart,
    });
  }
  return out;
}

export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** SHA-1 via WebCrypto — present in the WebView, in Tauri, and in Node. */
export async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-1', bytes as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

/**
 * Verify every fully-contained piece of a downloaded file.
 *
 * Returns null the moment a piece fails. A partial file is worse than none: it looks playable,
 * gets written to the locker, and only reveals itself as damage part-way through listening.
 */
export async function verifyFileBytes(
  meta: TorrentMeta,
  file: TorrentFile,
  bytes: Uint8Array,
): Promise<{ verifiedPieces: number; checkablePieces: number } | null> {
  const slices = piecesFullyInsideFile(meta, file);
  let verified = 0;
  for (const slice of slices) {
    const expected = meta.pieceHashes[slice.pieceIndex];
    if (!expected) continue;
    const actual = await sha1(bytes.subarray(slice.offsetInFile, slice.offsetInFile + slice.length));
    if (!hashesEqual(actual, expected)) return null;
    verified += 1;
  }
  return { verifiedPieces: verified, checkablePieces: slices.length };
}

/**
 * Fetch one file through the torrent's web seeds and verify it.
 *
 * Seeds are tried in order, because a torrent may list several and any one of them can be down.
 * A length mismatch is treated as failure before hashing: a truncated transfer that happens to
 * end on a piece boundary would otherwise verify every piece it did receive and look complete.
 */
export async function downloadVerifiedTorrentFile(
  meta: TorrentMeta,
  file: TorrentFile,
  options?: { signal?: AbortSignal; onProgress?: (received: number, total: number) => void },
): Promise<TorrentDownloadResult> {
  const seeds = meta.webSeeds.filter(Boolean);
  if (seeds.length === 0) return { reason: 'no-web-seed' };

  let lastReason: TorrentDownloadFailure = 'fetch-failed';
  for (const seed of seeds) {
    const url = webSeedUrlFor(seed, meta, file);
    if (!url) continue;
    try {
      const res = await fetch(url, { signal: options?.signal });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      options?.onProgress?.(bytes.length, file.length);

      if (file.length > 0 && bytes.length !== file.length) {
        lastReason = 'length-mismatch';
        continue;
      }
      const verdict = await verifyFileBytes(meta, file, bytes);
      if (!verdict) {
        lastReason = 'hash-mismatch';
        continue;
      }
      return { file: { bytes, ...verdict } };
    } catch {
      lastReason = 'fetch-failed';
    }
  }
  return { reason: lastReason };
}

/**
 * Fetch and parse the torrent an archive.org item publishes.
 *
 * Air-gapped installs get null rather than a request, matching every other WAN call in the app.
 * A missing torrent is normal — not every item has one — so this is a soft null, not an error.
 */
export async function fetchArchiveTorrent(identifier: string): Promise<TorrentMeta | null> {
  const url = archiveOrgTorrentUrl(identifier);
  if (!url || isAirGapEnabled()) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return parseTorrent(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
