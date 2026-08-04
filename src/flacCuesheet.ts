/**
 * Chapter offsets from a FLAC CUESHEET block.
 *
 * flacStreamInfo reads the first metadata block and stops, because depth and sample rate were all
 * it needed. A FLAC carries a chain of them, and one of the types is a cue sheet: the track index
 * of a CD, or — for anything ripped as a single file — the marks between its parts. That is a
 * chapter list, in the one format the chapter work so far could not read.
 *
 * Rarer than M4B atoms or ID3 frames, and worth having anyway. A lossless rip of an audiobook or a
 * live set is exactly the kind of file somebody keeps as one piece, and it is the only format of
 * the three where the marks are guaranteed sample-accurate rather than rounded to milliseconds.
 *
 * The one thing it will not give you is names. A cue sheet track carries an offset, a number and
 * an ISRC, and no title anywhere — titles live in a Vorbis comment if they exist at all. So every
 * chapter comes back untitled, and numbering them is the caller's business. Inventing "Chapter 4"
 * here would be putting words in the file's mouth, which is the one thing this project's parsers
 * consistently refuse to do.
 */

/** Same shape m4bChapters and id3Chapters use, so one reader serves all three. */
export type ByteRangeReader = (offset: number, length: number) => Promise<Uint8Array | null>;

export interface FlacChapter {
  startSeconds: number;
  /** Always empty: a cue sheet has nowhere to put a name. */
  title: string;
}

const FLAC_MARKER = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const STREAMINFO_BLOCK_TYPE = 0;
const CUESHEET_BLOCK_TYPE = 5;
const BLOCK_HEADER_BYTES = 4;
/** A chain longer than this is a malformed file, not a rich one. */
const MAX_BLOCKS = 64;
/** A cue sheet holds at most 100 CD tracks; the cap only stops a corrupt length being believed. */
const MAX_CUESHEET_BYTES = 1_048_576;

/*
 * Byte offsets inside a CUESHEET block. Fixed by the format, all byte-aligned, which is why this
 * slices rather than reading bit by bit the way STREAMINFO has to.
 */
const CUESHEET_TRACK_COUNT_OFFSET = 395;
const CUESHEET_FIRST_TRACK_OFFSET = 396;
const TRACK_HEADER_BYTES = 36;
const TRACK_NUMBER_OFFSET = 8;
const TRACK_INDEX_COUNT_OFFSET = 35;
const INDEX_POINT_BYTES = 12;

/**
 * The last entry is not a track.
 *
 * Every cue sheet ends with a lead-out marking where the audio stops — 170 on a CD, 255 otherwise.
 * Treated as a chapter it becomes a final entry that starts exactly where the file ends, and
 * seeking to it lands on silence or on nothing at all.
 */
const LEAD_OUT_CD = 170;
const LEAD_OUT_NON_CD = 255;

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 16_777_216 +
    bytes[offset + 1]! * 65_536 +
    bytes[offset + 2]! * 256 +
    bytes[offset + 3]!
  );
}

/** Sample offsets are 64-bit. Split rather than shifted — a shift would truncate to 32 bits. */
function readUint64(bytes: Uint8Array, offset: number): number {
  return readUint32(bytes, offset) * 4_294_967_296 + readUint32(bytes, offset + 4);
}

export interface FlacMetadataBlock {
  type: number;
  /** Offset of the block's payload, past its own four-byte header. */
  bodyOffset: number;
  bodyLength: number;
  isLast: boolean;
  nextOffset: number;
}

/**
 * Walk the metadata chain.
 *
 * Each block states its own length and whether it is the last, so this steps over the ones it does
 * not want without reading them — a PICTURE block holding cover art is routinely megabytes, and
 * there is no reason to pull it across to reach a cue sheet sitting behind it.
 */
export async function readFlacMetadataBlocks(
  read: ByteRangeReader,
  fileSize: number,
): Promise<FlacMetadataBlock[]> {
  if (!Number.isFinite(fileSize) || fileSize <= BLOCK_HEADER_BYTES) return [];
  const marker = await read(0, 4);
  if (!marker || marker.length < 4) return [];
  for (let i = 0; i < 4; i += 1) if (marker[i] !== FLAC_MARKER[i]) return [];

  const blocks: FlacMetadataBlock[] = [];
  let offset = 4;
  for (let i = 0; i < MAX_BLOCKS; i += 1) {
    if (offset + BLOCK_HEADER_BYTES > fileSize) break;
    const header = await read(offset, BLOCK_HEADER_BYTES);
    if (!header || header.length < BLOCK_HEADER_BYTES) break;
    const isLast = (header[0]! & 0x80) !== 0;
    const type = header[0]! & 0x7f;
    const bodyLength = header[1]! * 65_536 + header[2]! * 256 + header[3]!;
    const bodyOffset = offset + BLOCK_HEADER_BYTES;
    if (bodyOffset + bodyLength > fileSize) break;
    blocks.push({ type, bodyOffset, bodyLength, isLast, nextOffset: bodyOffset + bodyLength });
    offset = bodyOffset + bodyLength;
    if (isLast) break;
  }
  return blocks;
}

/**
 * Parse a CUESHEET payload into chapter offsets.
 *
 * `sampleRate` converts them: the format stores sample counts, which is what makes the marks exact
 * and also what makes them meaningless without STREAMINFO to divide by.
 */
export function parseFlacCuesheet(body: Uint8Array, sampleRate: number): FlacChapter[] {
  if (!(sampleRate > 0)) return [];
  if (body.length <= CUESHEET_FIRST_TRACK_OFFSET) return [];

  const trackCount = body[CUESHEET_TRACK_COUNT_OFFSET]!;
  if (trackCount <= 0) return [];

  const chapters: FlacChapter[] = [];
  let at = CUESHEET_FIRST_TRACK_OFFSET;
  for (let i = 0; i < trackCount; i += 1) {
    if (at + TRACK_HEADER_BYTES > body.length) return chapters;
    const offsetSamples = readUint64(body, at);
    const number = body[at + TRACK_NUMBER_OFFSET]!;
    const indexPoints = body[at + TRACK_INDEX_COUNT_OFFSET]!;
    at += TRACK_HEADER_BYTES + indexPoints * INDEX_POINT_BYTES;

    if (number === LEAD_OUT_CD || number === LEAD_OUT_NON_CD) continue;
    if (!Number.isFinite(offsetSamples) || offsetSamples < 0) continue;
    chapters.push({ startSeconds: offsetSamples / sampleRate, title: '' });
  }
  return chapters;
}

/**
 * Chapters from a FLAC's cue sheet, or an empty list when it carries none.
 *
 * Needs two blocks and reads only those: STREAMINFO for the sample rate, CUESHEET for the marks.
 * Everything between them is stepped over by its declared length.
 */
export async function readFlacChapters(
  read: ByteRangeReader,
  fileSize: number,
): Promise<FlacChapter[]> {
  const blocks = await readFlacMetadataBlocks(read, fileSize);
  if (blocks.length === 0) return [];

  const cuesheet = blocks.find((b) => b.type === CUESHEET_BLOCK_TYPE);
  if (!cuesheet) return [];
  const streaminfo = blocks.find((b) => b.type === STREAMINFO_BLOCK_TYPE);
  if (!streaminfo) return [];

  const head = await read(streaminfo.bodyOffset, streaminfo.bodyLength);
  if (!head || head.length < 18) return [];
  /*
   * Sample rate is 20 bits starting 80 bits into STREAMINFO, so it straddles bytes 10, 11 and the
   * top nibble of 12. Read directly rather than pulling in the bit reader for one field.
   */
  const sampleRate = head[10]! * 4_096 + head[11]! * 16 + (head[12]! >> 4);
  if (!(sampleRate > 0)) return [];

  const body = await read(
    cuesheet.bodyOffset,
    Math.min(cuesheet.bodyLength, MAX_CUESHEET_BYTES),
  );
  if (!body) return [];
  return parseFlacCuesheet(body, sampleRate);
}
