/**
 * Chapters inside an MP3, read from its ID3 tag.
 *
 * The M4B work assumed the format question was settled: a single-file audiobook is an MP4, so
 * parse MP4 atoms. The only audiobook on the test phone is an 845 megabyte MP3 running past thirty
 * hours, which is precisely the file a chapter-scoped bar exists for and carries no MP4 atoms at
 * all. MP3 audiobooks are not an edge case — a great many are produced exactly this way — and they
 * put their chapters in ID3v2 CHAP frames instead.
 *
 * Same discipline as m4bChapters: walk headers, never read the audio. Here the trap is different.
 * An ID3 tag sits at the very front of the file, so finding it is trivial, but it usually contains
 * the cover art, and cover art is most of the tag. The book on the phone has a 264 kilobyte tag of
 * which nearly all is one APIC frame. So this reads each frame's ten-byte header, takes the body
 * only for the frames it wants, and steps over everything else by its declared size.
 *
 * Chapters are a 2005 addendum to ID3v2, not part of the original spec, which is why the layout
 * reads oddly: a CHAP frame is a frame that contains frames. Its own payload holds the timings,
 * and the chapter's name arrives as a nested TIT2 exactly as a track title would.
 */

/** Fetch a byte range. Same shape m4bChapters uses, so one reader serves both. */
export type ByteRangeReader = (offset: number, length: number) => Promise<Uint8Array | null>;

export interface Id3Chapter {
  startSeconds: number;
  title: string;
}

const HEADER_BYTES = 10;
const FRAME_HEADER_BYTES = 10;
/** Enough for any real tag; a corrupt size should not walk forever. */
const MAX_FRAMES = 512;
/** The addendum marks an unused time or offset with all bits set. */
const UNSET_U32 = 0xffff_ffff;

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 16_777_216 +
    bytes[offset + 1]! * 65_536 +
    bytes[offset + 2]! * 256 +
    bytes[offset + 3]!
  );
}

/**
 * A size stored seven bits per byte, so it can never contain a byte that looks like a frame sync.
 *
 * The tag's own size is always in this form. Frame sizes are only in ID3v2.4, and even there not
 * always — see frameSize.
 */
function readSyncsafe(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! & 0x7f) * 2_097_152 +
    (bytes[offset + 1]! & 0x7f) * 16_384 +
    (bytes[offset + 2]! & 0x7f) * 128 +
    (bytes[offset + 3]! & 0x7f)
  );
}

/**
 * A frame's declared size, given the tag version.
 *
 * ID3v2.3 stores it plainly and ID3v2.4 stores it syncsafe. Encoders get this wrong often enough
 * that trusting the version alone mis-parses real files: a well-known class of v2.4 writers emits
 * plain sizes. A byte with its top bit set cannot be part of a syncsafe number, so its presence is
 * proof the size is plain whatever the header claims.
 */
export function frameSize(bytes: Uint8Array, offset: number, major: number): number {
  if (major < 4) return readUint32(bytes, offset);
  const plainLooking =
    (bytes[offset]! | bytes[offset + 1]! | bytes[offset + 2]! | bytes[offset + 3]!) & 0x80;
  return plainLooking ? readUint32(bytes, offset) : readSyncsafe(bytes, offset);
}

function isFrameId(bytes: Uint8Array, offset: number): boolean {
  for (let i = 0; i < 4; i++) {
    const c = bytes[offset + i]!;
    const upper = c >= 65 && c <= 90;
    const digit = c >= 48 && c <= 57;
    if (!upper && !digit) return false;
  }
  return true;
}

function frameId(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

/**
 * Decode an ID3 text value: one encoding byte, then the text.
 *
 * UTF-16 is worth handling properly rather than approximating. A book whose chapters are named in
 * Thai or Russian is exactly the case where a mangled title is most obvious and least excusable.
 */
export function decodeId3Text(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const encoding = bytes[0]!;
  const body = bytes.subarray(1);
  let text: string;
  try {
    if (encoding === 1) {
      // UTF-16 with a byte order mark, which decides endianness for us.
      const littleEndian = body[0] === 0xff && body[1] === 0xfe;
      text = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(body);
    } else if (encoding === 2) {
      text = new TextDecoder('utf-16be').decode(body);
    } else if (encoding === 3) {
      text = new TextDecoder('utf-8').decode(body);
    } else {
      text = new TextDecoder('windows-1252').decode(body);
    }
  } catch {
    return '';
  }
  // Text frames are null-terminated, and a stray BOM survives decoding as a zero-width space.
  return text.replace(/\0+$/, '').replace(/^﻿/, '').trim();
}

/**
 * Parse one CHAP payload.
 *
 * Layout: a null-terminated element id, then start and end times in milliseconds, then start and
 * end byte offsets, then any number of nested frames. Only the start time and a nested TIT2 are
 * of any use here — the end time is the next chapter's start, and the byte offsets are almost
 * always unset.
 */
export function parseChapFrame(body: Uint8Array, major: number): Id3Chapter | null {
  const nul = body.indexOf(0);
  if (nul < 0) return null;
  // Element id, four 32-bit fields, and room for a nested frame header.
  let at = nul + 1;
  if (at + 16 > body.length) return null;

  const startMs = readUint32(body, at);
  at += 16;
  if (startMs === UNSET_U32) return null;

  let title = '';
  // Nested frames. A CHAP normally holds exactly one TIT2, but nothing forbids more.
  let cursor = at;
  for (let i = 0; i < 8 && cursor + FRAME_HEADER_BYTES <= body.length; i++) {
    if (!isFrameId(body, cursor)) break;
    const id = frameId(body, cursor);
    const size = frameSize(body, cursor + 4, major);
    const start = cursor + FRAME_HEADER_BYTES;
    if (size <= 0 || start + size > body.length) break;
    if (id === 'TIT2' && !title) title = decodeId3Text(body.subarray(start, start + size));
    cursor = start + size;
  }

  return { startSeconds: startMs / 1000, title };
}

/**
 * Chapters from an MP3's ID3 tag, or an empty list when it carries none.
 *
 * Returns them in file order. Ordering and de-duplication are the caller's business, exactly as
 * with the MP4 path, so both parsers can share one normaliser.
 */
export async function readId3Chapters(
  read: ByteRangeReader,
  fileSize: number,
): Promise<Id3Chapter[]> {
  if (!Number.isFinite(fileSize) || fileSize <= HEADER_BYTES) return [];

  const header = await read(0, HEADER_BYTES);
  if (!header || header.length < HEADER_BYTES) return [];
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return []; // "ID3"

  const major = header[3]!;
  // CHAP was added alongside ID3v2.3. Nothing older can carry one.
  if (major < 3 || major > 4) return [];

  const flags = header[5]!;
  /*
   * Unsynchronisation rewrites the tag's bytes so no run of them can be mistaken for the start of
   * an audio frame, which means every declared size inside it is a size in the rewritten bytes.
   * Walking it without undoing that lands mid-frame. It is vanishingly rare in tags that carry
   * chapters, so this declines rather than guesses.
   */
  if (flags & 0x80) return [];

  const tagSize = readSyncsafe(header, 6);
  if (tagSize <= 0) return [];
  const tagEnd = Math.min(HEADER_BYTES + tagSize, fileSize);

  let offset = HEADER_BYTES;
  if (flags & 0x40) {
    // Extended header: its own size comes first, and it is of no interest beyond skipping.
    const ext = await read(offset, 4);
    if (!ext || ext.length < 4) return [];
    const extSize = major === 4 ? readSyncsafe(ext, 0) : readUint32(ext, 0) + 4;
    if (extSize <= 0) return [];
    offset += extSize;
  }

  const chapters: Id3Chapter[] = [];
  for (let i = 0; i < MAX_FRAMES && offset + FRAME_HEADER_BYTES <= tagEnd; i++) {
    const frame = await read(offset, FRAME_HEADER_BYTES);
    if (!frame || frame.length < FRAME_HEADER_BYTES) break;
    // A zero id is the padding that fills the rest of the tag; there are no frames after it.
    if (!isFrameId(frame, 0)) break;

    const id = frameId(frame, 0);
    const size = frameSize(frame, 4, major);
    if (size <= 0 || offset + FRAME_HEADER_BYTES + size > tagEnd) break;

    if (id === 'CHAP') {
      const body = await read(offset + FRAME_HEADER_BYTES, size);
      // Everything else is stepped over unread. The cover art alone is usually most of the tag.
      if (body) {
        const chapter = parseChapFrame(body, major);
        if (chapter) chapters.push(chapter);
      }
    }
    offset += FRAME_HEADER_BYTES + size;
  }

  return chapters;
}
