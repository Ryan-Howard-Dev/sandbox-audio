import { describe, expect, it, vi } from 'vitest';
import type { TorrentFile, TorrentMeta } from './torrentMeta';
import {
  downloadVerifiedTorrentFile,
  hashesEqual,
  piecesFullyInsideFile,
  sha1,
  verifyFileBytes,
} from './torrentDownload';

const PIECE = 16;

/** Two files of two pieces each, laid over one continuous piece stream. */
function meta(partial: Partial<TorrentMeta> = {}): TorrentMeta {
  return {
    name: 'item',
    files: [
      { path: 'a.mp3', length: 32, offset: 0 },
      { path: 'b.mp3', length: 32, offset: 32 },
    ],
    totalLength: 64,
    pieceLength: PIECE,
    pieceHashes: [new Uint8Array(20), new Uint8Array(20), new Uint8Array(20), new Uint8Array(20)],
    webSeeds: ['https://archive.org/download/item/'],
    ...partial,
  };
}

async function metaWithRealHashes(bytes: Uint8Array): Promise<TorrentMeta> {
  const hashes: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += PIECE) {
    hashes.push(await sha1(bytes.subarray(at, Math.min(at + PIECE, bytes.length))));
  }
  return meta({ pieceHashes: hashes });
}

describe('sha1', () => {
  it('matches the known digest for "abc"', async () => {
    const digest = await sha1(new TextEncoder().encode('abc'));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});

describe('hashesEqual', () => {
  it('compares content, not identity', () => {
    expect(hashesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(hashesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(hashesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('piecesFullyInsideFile', () => {
  it('lists the pieces belonging entirely to a file', () => {
    const m = meta();
    expect(piecesFullyInsideFile(m, m.files[0]!)).toEqual([
      { pieceIndex: 0, offsetInFile: 0, length: 16 },
      { pieceIndex: 1, offsetInFile: 16, length: 16 },
    ]);
  });

  it('offsets are relative to the file, not the torrent', () => {
    const m = meta();
    expect(piecesFullyInsideFile(m, m.files[1]!)).toEqual([
      { pieceIndex: 2, offsetInFile: 0, length: 16 },
      { pieceIndex: 3, offsetInFile: 16, length: 16 },
    ]);
  });

  /*
   * A piece straddling two files hashes the concatenation of both. Checking it against one file's
   * bytes would fail for a file that is perfectly intact, so those pieces are excluded rather
   * than guessed at.
   */
  it('excludes pieces that straddle a file boundary', () => {
    const m = meta({
      files: [
        { path: 'a.mp3', length: 24, offset: 0 },
        { path: 'b.mp3', length: 40, offset: 24 },
      ],
    });
    // Piece 1 covers bytes 16-31, crossing the boundary at 24.
    expect(piecesFullyInsideFile(m, m.files[0]!).map((p) => p.pieceIndex)).toEqual([0]);
    expect(piecesFullyInsideFile(m, m.files[1]!).map((p) => p.pieceIndex)).toEqual([2, 3]);
  });

  /* The last piece of a torrent is short; treating it as full length would run past the end. */
  it('clamps the final short piece', () => {
    const m = meta({
      files: [{ path: 'only.mp3', length: 40, offset: 0 }],
      totalLength: 40,
      pieceHashes: [new Uint8Array(20), new Uint8Array(20), new Uint8Array(20)],
    });
    const slices = piecesFullyInsideFile(m, m.files[0]!);
    expect(slices).toHaveLength(3);
    expect(slices[2]).toEqual({ pieceIndex: 2, offsetInFile: 32, length: 8 });
  });

  it('is empty for a nonsense piece length', () => {
    const m = meta({ pieceLength: 0 });
    expect(piecesFullyInsideFile(m, m.files[0]!)).toEqual([]);
  });
});

describe('verifyFileBytes', () => {
  const content = new Uint8Array(64).map((_, i) => i);

  it('accepts bytes matching the published hashes', async () => {
    const m = await metaWithRealHashes(content);
    const verdict = await verifyFileBytes(m, m.files[0]!, content.subarray(0, 32));
    expect(verdict).toEqual({ verifiedPieces: 2, checkablePieces: 2 });
  });

  it('rejects a single flipped byte', async () => {
    const m = await metaWithRealHashes(content);
    const damaged = content.slice(0, 32);
    damaged[20] = damaged[20]! ^ 0xff;
    expect(await verifyFileBytes(m, m.files[0]!, damaged)).toBeNull();
  });

  /*
   * Reporting what was actually checked matters: a caller can then say "verified 2 of 2 pieces"
   * rather than implying the whole file was proven when boundary pieces never could be.
   */
  it('reports how much could be checked at all', async () => {
    const m = meta({
      files: [
        { path: 'a.mp3', length: 24, offset: 0 },
        { path: 'b.mp3', length: 40, offset: 24 },
      ],
    });
    const bytes = new Uint8Array(24);
    m.pieceHashes[0] = await sha1(bytes.subarray(0, 16));
    const verdict = await verifyFileBytes(m, m.files[0]!, bytes);
    expect(verdict).toEqual({ verifiedPieces: 1, checkablePieces: 1 });
  });
});

describe('downloadVerifiedTorrentFile', () => {
  const content = new Uint8Array(64).map((_, i) => i);

  function stubFetch(impl: (url: string) => Response | Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(impl(url))));
  }

  it('downloads and verifies through the web seed', async () => {
    const m = await metaWithRealHashes(content);
    stubFetch(() => new Response(content.slice(0, 32)));
    const { file, reason } = await downloadVerifiedTorrentFile(m, m.files[0]!);
    expect(reason).toBeUndefined();
    expect(file?.verifiedPieces).toBe(2);
    vi.unstubAllGlobals();
  });

  it('says so when the torrent has no web seed to fetch from', async () => {
    const m = meta({ webSeeds: [] });
    expect(await downloadVerifiedTorrentFile(m, m.files[0]!)).toEqual({ reason: 'no-web-seed' });
  });

  /*
   * A truncated transfer ending on a piece boundary would verify every piece it did receive and
   * look complete, so length is checked before hashing.
   */
  it('rejects a truncated transfer before hashing it', async () => {
    const m = await metaWithRealHashes(content);
    stubFetch(() => new Response(content.slice(0, 16)));
    expect(await downloadVerifiedTorrentFile(m, m.files[0]!)).toEqual({
      reason: 'length-mismatch',
    });
    vi.unstubAllGlobals();
  });

  it('rejects corrupted bytes rather than storing them', async () => {
    const m = await metaWithRealHashes(content);
    const damaged = content.slice(0, 32);
    damaged[5] = 0xff;
    stubFetch(() => new Response(damaged));
    expect(await downloadVerifiedTorrentFile(m, m.files[0]!)).toEqual({ reason: 'hash-mismatch' });
    vi.unstubAllGlobals();
  });

  /* A torrent may list several seeds and any one of them can be down. */
  it('falls through to a working seed', async () => {
    const m = await metaWithRealHashes(content);
    m.webSeeds = ['https://dead.example/', 'https://archive.org/download/item/'];
    stubFetch((url) =>
      url.startsWith('https://dead.example/')
        ? new Response(null, { status: 503 })
        : new Response(content.slice(0, 32)),
    );
    const { file } = await downloadVerifiedTorrentFile(m, m.files[0]!);
    expect(file?.verifiedPieces).toBe(2);
    vi.unstubAllGlobals();
  });

  it('reports a network failure rather than throwing', async () => {
    const m = await metaWithRealHashes(content);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await downloadVerifiedTorrentFile(m, m.files[0]!)).toEqual({ reason: 'fetch-failed' });
    vi.unstubAllGlobals();
  });

  it('reports progress for a caller to display', async () => {
    const m = await metaWithRealHashes(content);
    stubFetch(() => new Response(content.slice(0, 32)));
    const onProgress = vi.fn();
    await downloadVerifiedTorrentFile(m, m.files[0]!, { onProgress });
    expect(onProgress).toHaveBeenCalledWith(32, 32);
    vi.unstubAllGlobals();
  });
});
