/**
 * M4B chapters, read from the file header rather than the file.
 *
 * An audiobook often ships as a single MPEG-4 container running tens of hours and several
 * gigabytes, with its chapters embedded rather than split across files. Without reading them the
 * book is one enormous track: no chapter list, no resume to a chapter, no sense of where you are.
 *
 * MP4 stores everything in nested atoms. The audio lives in `mdat`, which is essentially the whole
 * file, and every piece of metadata lives in `moov`, which is tiny. Older encoders append `moov`
 * after `mdat`; `faststart` encoders move it to the front. Either way it can be reached by walking
 * atom headers and *skipping* over `mdat` by its declared size — so a nine-hour book costs a few
 * kilobytes of reading, not gigabytes of memory.
 *
 * This module never loads audio. Given a reader that can fetch byte ranges, it returns chapters.
 */

export interface M4bChapter {
  /** Start time from the beginning of the book. */
  startSeconds: number;
  title: string;
}

/** Fetch a byte range. Backed by a Blob slice, a file handle, or a native head read. */
export type ByteRangeReader = (offset: number, length: number) => Promise<Uint8Array | null>;

interface AtomHeader {
  type: string;
  /** Offset of the atom's payload, past its own header. */
  bodyOffset: number;
  /** Payload length in bytes. */
  bodyLength: number;
  /** Offset of the next atom. */
  nextOffset: number;
}

const HEADER_BYTES = 8;
/** A 64-bit atom declares size 1 and puts the real size in the following eight bytes. */
const LARGE_SIZE_MARKER = 1;

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 16_777_216 +
    bytes[offset + 1]! * 65_536 +
    bytes[offset + 2]! * 256 +
    bytes[offset + 3]!
  );
}

function readUint64(bytes: Uint8Array, offset: number): number {
  // Split rather than shift: a 64-bit atom size overflows 32-bit bitwise maths.
  return readUint32(bytes, offset) * 4_294_967_296 + readUint32(bytes, offset + 4);
}

function readType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

async function readAtomHeader(
  read: ByteRangeReader,
  offset: number,
): Promise<AtomHeader | null> {
  const head = await read(offset, 16);
  if (!head || head.length < HEADER_BYTES) return null;

  const declared = readUint32(head, 0);
  const type = readType(head, 4);
  if (!/^[\x20-\x7e]{4}$/.test(type)) return null;

  if (declared === LARGE_SIZE_MARKER) {
    if (head.length < 16) return null;
    const size = readUint64(head, 8);
    if (size <= 16) return null;
    return { type, bodyOffset: offset + 16, bodyLength: size - 16, nextOffset: offset + size };
  }
  // Size 0 means "extends to end of file" — legal, and only ever the last atom.
  if (declared === 0) {
    return {
      type,
      bodyOffset: offset + HEADER_BYTES,
      bodyLength: Number.MAX_SAFE_INTEGER,
      nextOffset: Number.MAX_SAFE_INTEGER,
    };
  }
  if (declared < HEADER_BYTES) return null;
  return {
    type,
    bodyOffset: offset + HEADER_BYTES,
    bodyLength: declared - HEADER_BYTES,
    nextOffset: offset + declared,
  };
}

/**
 * Walk sibling atoms at one level, looking for a type.
 *
 * The point of the whole approach: `mdat` is skipped by its declared size rather than read, so
 * passing over gigabytes of audio costs one seek.
 */
async function findAtom(
  read: ByteRangeReader,
  startOffset: number,
  endOffset: number,
  wanted: string,
  maxAtoms = 64,
): Promise<AtomHeader | null> {
  let offset = startOffset;
  for (let i = 0; i < maxAtoms && offset < endOffset; i++) {
    const atom = await readAtomHeader(read, offset);
    if (!atom) return null;
    if (atom.type === wanted) return atom;
    if (atom.nextOffset <= offset) return null; // malformed; refuse to loop
    offset = atom.nextOffset;
  }
  return null;
}

/** Nero timestamps count 100-nanosecond units. */
const CHPL_TICKS_PER_SECOND = 10_000_000;

/**
 * Parse a `chpl` payload.
 *
 * Layout after the atom header: one version byte, three flag bytes, then a chapter count and, per
 * chapter, an eight-byte start time followed by a length-prefixed UTF-8 title.
 *
 * The count is a byte in the original Nero layout and a 32-bit integer in the variant most tools
 * now write. Both appear in real files, so the shape is detected rather than assumed — reading the
 * wrong one yields either one chapter or tens of thousands of nonsense entries.
 */
export function parseChplPayload(body: Uint8Array): M4bChapter[] {
  if (body.length < 9) return [];
  const decoder = new TextDecoder('utf-8');

  const attempt = (countOffset: number, countIsByte: boolean): M4bChapter[] | null => {
    const count = countIsByte ? body[countOffset]! : readUint32(body, countOffset);
    if (count <= 0 || count > 100_000) return null;
    const chapters: M4bChapter[] = [];
    let at = countOffset + (countIsByte ? 1 : 4);
    for (let i = 0; i < count; i++) {
      if (at + 9 > body.length) return null;
      const ticks = readUint64(body, at);
      at += 8;
      const titleLength = body[at]!;
      at += 1;
      if (at + titleLength > body.length) return null;
      const title = decoder.decode(body.subarray(at, at + titleLength)).trim();
      at += titleLength;
      chapters.push({ startSeconds: ticks / CHPL_TICKS_PER_SECOND, title });
    }
    return chapters;
  };

  // 4 bytes version+flags, then either a 32-bit count (common) or a single byte (original Nero).
  return attempt(4, false) ?? attempt(4, true) ?? [];
}

/**
 * Chapters from an M4B, or an empty list when it carries none.
 *
 * `fileSize` bounds the walk so a malformed atom cannot send the reader past the end of the file.
 */
export async function readM4bChapters(
  read: ByteRangeReader,
  fileSize: number,
): Promise<M4bChapter[]> {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return [];

  const moov = await findAtom(read, 0, fileSize, 'moov');
  if (!moov) return [];
  const moovEnd = Math.min(moov.bodyOffset + moov.bodyLength, fileSize);

  const udta = await findAtom(read, moov.bodyOffset, moovEnd, 'udta');
  if (!udta) return [];
  const udtaEnd = Math.min(udta.bodyOffset + udta.bodyLength, moovEnd);

  const chpl = await findAtom(read, udta.bodyOffset, udtaEnd, 'chpl');
  if (!chpl) return [];

  // chpl is metadata; a sane cap keeps a corrupt size from requesting an absurd read.
  const length = Math.min(chpl.bodyLength, 1_048_576);
  const body = await read(chpl.bodyOffset, length);
  if (!body) return [];

  return normaliseChapters(parseChplPayload(body));
}

/**
 * Order chapters and drop ones that cannot be used.
 *
 * Encoders occasionally emit a zero-length or duplicated marker, which would render as a chapter
 * that cannot be selected. Titles are left exactly as the book states them — an untitled chapter
 * is reported empty rather than renamed "Chapter 4", because inventing a number the book does not
 * use is the sort of quiet fabrication this project avoids.
 */
export function normaliseChapters(chapters: M4bChapter[]): M4bChapter[] {
  const sorted = [...chapters]
    .filter((chapter) => Number.isFinite(chapter.startSeconds) && chapter.startSeconds >= 0)
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const out: M4bChapter[] = [];
  for (const chapter of sorted) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(previous.startSeconds - chapter.startSeconds) < 0.001) {
      // Same instant twice: keep whichever actually has a title.
      if (!previous.title && chapter.title) out[out.length - 1] = chapter;
      continue;
    }
    out.push(chapter);
  }
  return out;
}

/** A Blob-backed reader, for a picked file or a locker entry. */
export function blobByteRangeReader(blob: Blob): ByteRangeReader {
  return async (offset, length) => {
    if (offset < 0 || length <= 0 || offset >= blob.size) return null;
    const end = Math.min(offset + length, blob.size);
    return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
  };
}
