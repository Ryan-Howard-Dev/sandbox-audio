/**
 * What a Kindle file actually is, before trying to read it.
 *
 * Thirty-five books on this device open in nothing. They are AZW3, MOBI and KFX, and the shelf
 * treats all three the same way it treats a corrupt file: it fails. That is the wrong answer twice
 * over, because two of those formats are readable and the third never will be, and a user deserves
 * to be told which they have rather than watching an import fail silently.
 *
 * This reads headers only. It answers three questions — what format, is it protected, and what is
 * it called — from the first few kilobytes, and never decompresses anything. Attempting to
 * decompress a protected file produces garbage bytes rather than an error, so the check has to
 * come first.
 *
 * AZW3 and MOBI share the Palm Database container from the 1990s, which is why one parser covers
 * both. KFX abandoned it entirely for a proprietary serialisation format, which is why nothing
 * here can read one.
 */

export type KindleFormat = 'mobi' | 'azw3' | 'kfx' | 'not-kindle';

export interface KindleFileInfo {
  format: KindleFormat;
  /** True when the file is protected. Readable formats can still be protected. */
  drm: boolean;
  /** Why it cannot be opened, in words a reader can act on. Absent when it can. */
  blockedReason?: 'drm' | 'kfx-unsupported';
  title?: string;
  /** Record index where images start, needed to find the cover. */
  firstImageIndex?: number;
  /** Offset of the cover within the image records, from EXTH tag 201. */
  coverOffset?: number;
}

/*
 * "BOOKMOBI" at offset 60 is the Palm Database type and creator pair, and is the signature every
 * MOBI and AZW3 carries. AZW3 differs only by a version number deeper in the header.
 */
const PDB_MAGIC_OFFSET = 60;
const PDB_MAGIC = 'BOOKMOBI';
const PDB_RECORD_COUNT_OFFSET = 76;
const PDB_RECORD_LIST_OFFSET = 78;
const PDB_RECORD_ENTRY_BYTES = 8;

/** Encrypted KFX containers announce themselves in the first eight bytes. */
const KFX_DRM_SIGNATURE = 'DRMION';

const PALMDOC_ENCRYPTION_OFFSET = 12;
const MOBI_HEADER_OFFSET = 16;
const MOBI_HEADER_LENGTH_OFFSET = 20;
const MOBI_FILE_VERSION_OFFSET = 36;
const MOBI_FULL_NAME_OFFSET = 84;
const MOBI_FIRST_IMAGE_OFFSET = 108;
const MOBI_EXTH_FLAGS_OFFSET = 128;
const MOBI_DRM_OFFSET = 168;
/** No DRM keys present. Any other value means there are. */
const NO_DRM = 0xffffffff;
const EXTH_PRESENT_FLAG = 0x40;
const EXTH_TAG_COVER_OFFSET = 201;
const EXTH_TAG_UPDATED_TITLE = 503;

function ascii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Identify a file from its head.
 *
 * Deliberately takes a small buffer rather than the whole file. A 20 MB book read whole into the
 * WebView costs far more than 20 MB once it is a string and an array at once, and this needs only
 * the headers. The caller should pass the first 8 KB or so.
 */
export function readKindleFileInfo(head: ArrayBuffer): KindleFileInfo {
  const bytes = new Uint8Array(head);
  if (bytes.byteLength >= 8) {
    const signature = String.fromCharCode(...bytes.subarray(0, 8));
    if (signature.startsWith(KFX_DRM_SIGNATURE)) {
      return { format: 'kfx', drm: true, blockedReason: 'kfx-unsupported' };
    }
  }

  const view = new DataView(head);
  if (bytes.byteLength < PDB_RECORD_LIST_OFFSET + PDB_RECORD_ENTRY_BYTES) {
    return { format: 'not-kindle', drm: false };
  }
  if (ascii(view, PDB_MAGIC_OFFSET, 8) !== PDB_MAGIC) {
    return { format: 'not-kindle', drm: false };
  }

  const recordCount = view.getUint16(PDB_RECORD_COUNT_OFFSET);
  if (recordCount === 0) return { format: 'not-kindle', drm: false };

  const record0 = view.getUint32(PDB_RECORD_LIST_OFFSET);
  // A header past the end of what we were given means the caller passed too little, not that the
  // file is broken. Say not-kindle rather than guess.
  if (record0 + MOBI_DRM_OFFSET + 4 > bytes.byteLength) {
    return { format: 'not-kindle', drm: false };
  }

  const encryption = view.getUint16(record0 + PALMDOC_ENCRYPTION_OFFSET);
  const drmOffset = view.getUint32(record0 + MOBI_DRM_OFFSET);
  // Either check alone misses files: some carry keys without setting the flag, and vice versa.
  const drm = encryption === 1 || encryption === 2 || drmOffset !== NO_DRM;

  const fileVersion = view.getUint32(record0 + MOBI_FILE_VERSION_OFFSET);
  const format: KindleFormat = fileVersion >= 8 ? 'azw3' : 'mobi';

  const info: KindleFileInfo = {
    format,
    drm,
    blockedReason: drm ? 'drm' : undefined,
    firstImageIndex: view.getUint32(record0 + MOBI_FIRST_IMAGE_OFFSET),
  };

  /*
   * The database name in the PDB header is truncated and often mis-encoded, so the real title
   * lives at fullNameOffset, and a better one still may be in the EXTH records.
   */
  const fullNameOffset = view.getUint32(record0 + MOBI_FULL_NAME_OFFSET);
  const titleAt = record0 + fullNameOffset;
  if (titleAt < bytes.byteLength) {
    const title = ascii(view, titleAt, Math.min(256, bytes.byteLength - titleAt)).trim();
    if (title) info.title = title;
  }

  const exthFlags = view.getUint32(record0 + MOBI_EXTH_FLAGS_OFFSET);
  if ((exthFlags & EXTH_PRESENT_FLAG) !== 0) {
    const headerLength = view.getUint32(record0 + MOBI_HEADER_LENGTH_OFFSET);
    const exth = readExth(view, record0 + MOBI_HEADER_OFFSET + headerLength, bytes.byteLength);
    if (exth.title) info.title = exth.title;
    if (exth.coverOffset !== undefined) info.coverOffset = exth.coverOffset;
  }

  return info;
}

function readExth(
  view: DataView,
  start: number,
  limit: number,
): { title?: string; coverOffset?: number } {
  const out: { title?: string; coverOffset?: number } = {};
  if (start + 12 > limit) return out;
  if (ascii(view, start, 4) !== 'EXTH') return out;

  const count = view.getUint32(start + 8);
  let cursor = start + 12;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 8 > limit) break;
    const tag = view.getUint32(cursor);
    const length = view.getUint32(cursor + 4);
    // A zero or negative length would loop forever; a truncated record cannot be read.
    if (length < 8 || cursor + length > limit) break;
    const payloadAt = cursor + 8;
    const payloadLength = length - 8;
    if (tag === EXTH_TAG_UPDATED_TITLE) {
      const title = ascii(view, payloadAt, payloadLength).trim();
      if (title) out.title = title;
    } else if (tag === EXTH_TAG_COVER_OFFSET && payloadLength >= 4) {
      out.coverOffset = view.getUint32(payloadAt);
    }
    cursor += length;
  }
  return out;
}

/** True where the app can actually read the text, rather than merely recognise the file. */
export function isReadableKindleFile(info: KindleFileInfo): boolean {
  return (info.format === 'mobi' || info.format === 'azw3') && !info.drm;
}
