import { describe, expect, it } from 'vitest';
import { bencodeDecode, bencodeText } from './bencode';
import {
  archiveOrgTorrentUrl,
  audioFilesIn,
  parseArchiveDownloadUrl,
  parseTorrent,
  readWebSeeds,
  splitPieceHashes,
  webSeedUrlFor,
  type TorrentMeta,
} from './torrentMeta';

const enc = new TextEncoder();

/** Build bencode by hand so the fixtures are exactly what a real torrent contains. */
function bytes(...parts: Array<string | Uint8Array>): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function bstr(value: string): Uint8Array {
  return bytes(`${enc.encode(value).length}:`, value);
}

/** Two pieces' worth of SHA-1 digests: 40 bytes of distinguishable filler. */
const PIECES = new Uint8Array(40).map((_, i) => (i < 20 ? 0xaa : 0xbb));

const MULTI = bytes(
  'd',
  bstr('url-list'),
  bstr('https://archive.org/download/my_item/'),
  bstr('info'),
  'd',
  bstr('files'),
  'l',
  'd',
  bstr('length'),
  'i1000e',
  bstr('path'),
  'l',
  bstr('audio'),
  bstr('ch1.mp3'),
  'e',
  'e',
  'd',
  bstr('length'),
  'i2000e',
  bstr('path'),
  'l',
  bstr('cover.jpg'),
  'e',
  'e',
  'e',
  bstr('name'),
  bstr('my_item'),
  bstr('piece length'),
  'i16384e',
  bstr('pieces'),
  bytes(`${PIECES.length}:`),
  PIECES,
  'e',
  'e',
);

describe('bencodeDecode', () => {
  it('decodes the four types', () => {
    const decoded = bencodeDecode(bytes('d', bstr('a'), 'i42e', bstr('b'), 'l', bstr('x'), 'e', 'e'));
    const dict = decoded as Record<string, unknown>;
    expect(dict.a).toBe(42);
    expect(bencodeText((dict.b as Uint8Array[])[0])).toBe('x');
  });

  it('decodes negative integers', () => {
    expect(bencodeDecode(bytes('i-7e'))).toBe(-7);
  });

  /*
   * The reason byte strings are not decoded as text: `pieces` is raw concatenated SHA-1, and
   * UTF-8 decoding replaces invalid sequences with U+FFFD. The length still looks plausible, so
   * the corruption only surfaces later as a hash that never matches.
   */
  it('keeps binary payloads as bytes', () => {
    const raw = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
    const decoded = bencodeDecode(bytes(`${raw.length}:`, raw)) as Uint8Array;
    expect(Array.from(decoded)).toEqual([0xff, 0xfe, 0x00, 0x80]);
  });

  it('throws on truncated input rather than returning something plausible', () => {
    expect(() => bencodeDecode(bytes('d', bstr('a')))).toThrow(/bencode/);
    expect(() => bencodeDecode(bytes('5:abc'))).toThrow(/bencode/);
    expect(() => bencodeDecode(bytes('i42'))).toThrow(/bencode/);
  });
});

describe('splitPieceHashes', () => {
  it('splits into twenty-byte digests', () => {
    const hashes = splitPieceHashes(PIECES);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]![0]).toBe(0xaa);
    expect(hashes[1]![0]).toBe(0xbb);
  });

  it('ignores a trailing partial digest rather than emitting a short one', () => {
    expect(splitPieceHashes(new Uint8Array(25))).toHaveLength(1);
  });
});

describe('parseTorrent', () => {
  it('reads the manifest, piece hashes and web seed', () => {
    const meta = parseTorrent(MULTI)!;
    expect(meta.name).toBe('my_item');
    expect(meta.files.map((f) => f.path)).toEqual(['audio/ch1.mp3', 'cover.jpg']);
    expect(meta.totalLength).toBe(3000);
    expect(meta.pieceLength).toBe(16384);
    expect(meta.pieceHashes).toHaveLength(2);
    expect(meta.webSeeds).toEqual(['https://archive.org/download/my_item/']);
  });

  /* Offsets are what let a byte range be mapped back to the piece that verifies it. */
  it('gives each file its offset in the piece stream', () => {
    const meta = parseTorrent(MULTI)!;
    expect(meta.files[0]!.offset).toBe(0);
    expect(meta.files[1]!.offset).toBe(1000);
  });

  it('handles a single-file torrent, where the name is the file', () => {
    const single = bytes(
      'd',
      bstr('info'),
      'd',
      bstr('length'),
      'i500e',
      bstr('name'),
      bstr('lecture.mp3'),
      bstr('piece length'),
      'i16384e',
      bstr('pieces'),
      bytes(`${PIECES.length}:`),
      PIECES,
      'e',
      'e',
    );
    const meta = parseTorrent(single)!;
    expect(meta.files).toEqual([{ path: 'lecture.mp3', length: 500, offset: 0 }]);
  });

  it('returns null for anything that is not a torrent', () => {
    expect(parseTorrent(enc.encode('not a torrent'))).toBeNull();
    expect(parseTorrent(bytes('d', bstr('info'), 'd', 'e', 'e'))).toBeNull();
    expect(parseTorrent(new Uint8Array(0))).toBeNull();
  });
});

describe('readWebSeeds', () => {
  it('accepts a bare string, which some writers emit instead of a list', () => {
    expect(readWebSeeds({ 'url-list': enc.encode('https://x/') })).toEqual(['https://x/']);
  });

  it('is empty when there are none', () => {
    expect(readWebSeeds({})).toEqual([]);
  });
});

describe('webSeedUrlFor', () => {
  const meta = parseTorrent(MULTI)!;

  /*
   * BEP-19: a seed ending in '/' is a directory the name and path append to; anything else is a
   * direct link. Getting this backwards produces 404s that read as missing archive files.
   */
  it('appends name and path for a directory seed', () => {
    expect(webSeedUrlFor('https://archive.org/download/my_item/', meta, meta.files[0]!)).toBe(
      'https://archive.org/download/my_item/my_item/audio/ch1.mp3',
    );
  });

  it('uses a non-directory seed as the URL directly', () => {
    expect(webSeedUrlFor('https://x/file.mp3', meta, meta.files[0]!)).toBe('https://x/file.mp3');
  });

  it('escapes path segments without escaping the separators', () => {
    const spaced: TorrentMeta = { ...meta, name: 'my item' };
    const url = webSeedUrlFor('https://x/', spaced, { path: 'a b/c.mp3', length: 1, offset: 0 });
    expect(url).toBe('https://x/my%20item/a%20b/c.mp3');
  });

  it('is empty for a blank seed', () => {
    expect(webSeedUrlFor('  ', meta, meta.files[0]!)).toBe('');
  });
});

describe('archiveOrgTorrentUrl', () => {
  it('builds the per-item torrent path', () => {
    expect(archiveOrgTorrentUrl('fairy_tales_2311_librivox')).toBe(
      'https://archive.org/download/fairy_tales_2311_librivox/fairy_tales_2311_librivox_archive.torrent',
    );
  });

  it('is empty without an identifier', () => {
    expect(archiveOrgTorrentUrl('  ')).toBe('');
  });
});

describe('audioFilesIn', () => {
  it('keeps only playable audio', () => {
    const meta = parseTorrent(MULTI)!;
    expect(audioFilesIn(meta).map((f) => f.path)).toEqual(['audio/ch1.mp3']);
  });
});

describe('parseArchiveDownloadUrl', () => {
  it('splits an archive download URL into item and file', () => {
    expect(
      parseArchiveDownloadUrl('https://archive.org/download/my_item/audio/ch1.mp3'),
    ).toEqual({ identifier: 'my_item', path: 'audio/ch1.mp3' });
  });

  /* LibriVox chapter URLs use the www host; treating it as a different site would silently
     disable verification for that entire catalog. */
  it('accepts the www host as the same site', () => {
    expect(
      parseArchiveDownloadUrl('https://www.archive.org/download/fairy_tales/ch1.mp3'),
    ).toEqual({ identifier: 'fairy_tales', path: 'ch1.mp3' });
  });

  it('decodes escaped segments so the path matches the manifest', () => {
    expect(
      parseArchiveDownloadUrl('https://archive.org/download/my%20item/a%20b.mp3'),
    ).toEqual({ identifier: 'my item', path: 'a b.mp3' });
  });

  it('returns null for anything that is not an archive download URL', () => {
    expect(parseArchiveDownloadUrl('https://example.com/download/x/y.mp3')).toBeNull();
    expect(parseArchiveDownloadUrl('https://archive.org/details/my_item')).toBeNull();
    expect(parseArchiveDownloadUrl('https://archive.org/download/my_item')).toBeNull();
    expect(parseArchiveDownloadUrl('not a url')).toBeNull();
  });
});
