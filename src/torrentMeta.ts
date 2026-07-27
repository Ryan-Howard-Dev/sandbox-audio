/**
 * `.torrent` metadata → a file manifest, piece hashes, and HTTP sources.
 *
 * Built for the Internet Archive, which the app already uses for public-domain audiobooks and the
 * Live Music Archive. Its torrents carry web seeds (BEP-19): `url-list` points at ordinary
 * `https://archive.org/download/...` URLs for the very same files.
 *
 * That makes a peer swarm unnecessary. The torrent supplies the file list and the SHA-1 piece
 * hashes; the web seed supplies the bytes over plain HTTPS. No TCP or uTP stack, no listening
 * port, no NAT traversal, nothing a WebView cannot do — and the thing actually worth having comes
 * along anyway: every downloaded piece can be verified against a hash the archive published,
 * rather than trusted because the transfer returned 200.
 *
 * Decode only. Nothing here participates in a swarm, announces to a tracker, or uploads.
 */

import {
  bencodeDecode,
  bencodeDict,
  bencodeList,
  bencodeNumber,
  bencodeText,
  type BencodeValue,
} from './bencode';

export interface TorrentFile {
  /** Path inside the torrent, joined with '/'. */
  path: string;
  length: number;
  /** Byte offset of this file within the concatenated piece stream. */
  offset: number;
}

export interface TorrentMeta {
  name: string;
  files: TorrentFile[];
  totalLength: number;
  pieceLength: number;
  /** SHA-1 digest per piece, in order. */
  pieceHashes: Uint8Array[];
  /** BEP-19 web seeds — plain HTTP sources for the same content. */
  webSeeds: string[];
}

const SHA1_BYTES = 20;

/** Split the concatenated `pieces` blob into fixed-width digests. */
export function splitPieceHashes(pieces: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset + SHA1_BYTES <= pieces.length; offset += SHA1_BYTES) {
    out.push(pieces.subarray(offset, offset + SHA1_BYTES));
  }
  return out;
}

/** `url-list` is either a single string or a list of them, depending on who wrote the torrent. */
export function readWebSeeds(root: { [key: string]: BencodeValue }): string[] {
  const raw = root['url-list'];
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((value) => bencodeText(value).trim()).filter(Boolean);
}

/**
 * Resolve a file's download URL against a web seed.
 *
 * BEP-19 says a seed ending in '/' is a directory to which the torrent name and path are
 * appended; anything else is a direct link to a single-file torrent. Getting this wrong produces
 * 404s that look like the archive is missing the file.
 */
export function webSeedUrlFor(seed: string, meta: TorrentMeta, file: TorrentFile): string {
  const base = seed.trim();
  if (!base) return '';
  if (!base.endsWith('/')) return base;
  const segments = [meta.name, ...file.path.split('/')]
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `${base}${segments.join('/')}`;
}

export function parseTorrent(data: Uint8Array): TorrentMeta | null {
  let decoded: BencodeValue;
  try {
    decoded = bencodeDecode(data);
  } catch {
    return null;
  }
  const root = bencodeDict(decoded);
  const info = root ? bencodeDict(root['info']) : null;
  if (!root || !info) return null;

  const name = bencodeText(info['name']);
  const pieceLength = bencodeNumber(info['piece length']);
  const piecesRaw = info['pieces'];
  if (!name || pieceLength <= 0 || !(piecesRaw instanceof Uint8Array)) return null;

  const files: TorrentFile[] = [];
  let offset = 0;
  const fileList = bencodeList(info['files']);
  if (fileList.length > 0) {
    for (const entry of fileList) {
      const file = bencodeDict(entry);
      if (!file) continue;
      const length = bencodeNumber(file['length']);
      const path = bencodeList(file['path']).map((part) => bencodeText(part)).join('/');
      if (!path || length < 0) continue;
      files.push({ path, length, offset });
      offset += length;
    }
  } else {
    // Single-file torrent: the info dict's own name is the file.
    const length = bencodeNumber(info['length']);
    if (length <= 0) return null;
    files.push({ path: name, length, offset: 0 });
    offset = length;
  }
  if (files.length === 0) return null;

  return {
    name,
    files,
    totalLength: offset,
    pieceLength,
    pieceHashes: splitPieceHashes(piecesRaw),
    webSeeds: readWebSeeds(root),
  };
}

/** Archive.org publishes a torrent per item at a predictable path. */
export function archiveOrgTorrentUrl(identifier: string): string {
  const id = identifier.trim();
  if (!id) return '';
  return `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_archive.torrent`;
}

/** Audio files in the manifest, which is all this app has any use for. */
export function audioFilesIn(meta: TorrentMeta): TorrentFile[] {
  return meta.files.filter((file) => /\.(mp3|m4a|m4b|flac|ogg|opus|wav|aac)$/i.test(file.path));
}
