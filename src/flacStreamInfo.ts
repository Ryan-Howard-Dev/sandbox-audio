/**
 * FLAC STREAMINFO — what the encoder actually wrote.
 *
 * The bitrate shown today is bytes divided by duration, which is an honest average but says
 * nothing about the audio itself: it cannot tell 16-bit from 24-bit, 44.1 kHz from 96 kHz, or a
 * genuine FLAC from a file that merely ends in .flac. STREAMINFO is the first metadata block of
 * every FLAC stream and states all of it as fact, because the encoder put it there.
 *
 * It also carries an MD5 of the *unencoded* audio. That is the strongest integrity check available
 * without a second copy of the file: it verifies the decoded samples are exactly what the encoder
 * saw, which no container-level checksum can do.
 *
 * Layout, after the four-byte "fLaC" marker (see xiph/flac format documentation):
 *
 *   1 bit   last-metadata-block flag
 *   7 bits  block type (0 = STREAMINFO)
 *   24 bits block length
 *   then, big-endian and not byte-aligned:
 *   16 bits minimum block size      16 bits maximum block size
 *   24 bits minimum frame size      24 bits maximum frame size
 *   20 bits sample rate             3 bits channels - 1
 *   5 bits  bits per sample - 1     36 bits total samples
 *   128 bits MD5 of the unencoded audio
 *
 * The fields straddle byte boundaries, which is why this reads bit by bit rather than slicing.
 */

export interface FlacStreamInfo {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  /** Total interchannel samples; 0 when the encoder did not know (a stream rather than a file). */
  totalSamples: number;
  /** Length in seconds, or 0 when total samples are unknown. */
  durationSeconds: number;
  /** MD5 of the unencoded audio, lowercase hex. Empty when the encoder left it unset. */
  md5: string;
  minBlockSize: number;
  maxBlockSize: number;
}

const FLAC_MARKER = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const STREAMINFO_BLOCK_TYPE = 0;
const STREAMINFO_LENGTH = 34;

/** Reads big-endian bit fields that do not respect byte boundaries. */
class BitReader {
  private bit = 0;

  constructor(private readonly bytes: Uint8Array) {}

  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byteIndex = this.bit >> 3;
      if (byteIndex >= this.bytes.length) return value;
      const bitIndex = 7 - (this.bit & 7);
      const bit = (this.bytes[byteIndex]! >> bitIndex) & 1;
      // Multiply rather than shift: total samples is 36 bits and would overflow a 32-bit shift.
      value = value * 2 + bit;
      this.bit++;
    }
    return value;
  }
}

function isFlacMarker(bytes: Uint8Array, offset: number): boolean {
  return FLAC_MARKER.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Start of the FLAC stream, skipping an ID3v2 tag if one is in front of it.
 *
 * Taggers routinely prepend ID3 to FLAC even though the format has its own metadata, so a reader
 * that insists on "fLaC" at byte zero rejects a large number of perfectly valid files.
 */
function flacStreamOffset(bytes: Uint8Array): number {
  if (isFlacMarker(bytes, 0)) return 0;
  const hasId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33; // "ID3"
  if (!hasId3 || bytes.length < 10) return -1;
  // Syncsafe integer: seven bits per byte, top bit always clear.
  const size =
    (bytes[6]! & 0x7f) * 2_097_152 +
    (bytes[7]! & 0x7f) * 16_384 +
    (bytes[8]! & 0x7f) * 128 +
    (bytes[9]! & 0x7f);
  const offset = 10 + size;
  return isFlacMarker(bytes, offset) ? offset : -1;
}

/**
 * STREAMINFO from the head of a FLAC file, or null if this is not one.
 *
 * Only the first 8 KiB or so are needed — STREAMINFO is mandatory and must come first — so a
 * caller can read a small slice rather than the whole file.
 */
export function parseFlacStreamInfo(data: Uint8Array | ArrayBuffer): FlacStreamInfo | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const start = flacStreamOffset(bytes);
  if (start < 0) return null;

  const header = start + 4;
  if (bytes.length < header + 4 + STREAMINFO_LENGTH) return null;

  const blockType = bytes[header]! & 0x7f;
  if (blockType !== STREAMINFO_BLOCK_TYPE) return null;

  const blockLength = (bytes[header + 1]! << 16) | (bytes[header + 2]! << 8) | bytes[header + 3]!;
  if (blockLength !== STREAMINFO_LENGTH) return null;

  const body = bytes.subarray(header + 4, header + 4 + STREAMINFO_LENGTH);
  const reader = new BitReader(body);

  const minBlockSize = reader.read(16);
  const maxBlockSize = reader.read(16);
  reader.read(24); // minimum frame size — not useful here
  reader.read(24); // maximum frame size
  const sampleRateHz = reader.read(20);
  const channels = reader.read(3) + 1;
  const bitsPerSample = reader.read(5) + 1;
  const totalSamples = reader.read(36);

  // A zero sample rate is invalid per the format and means the header is not really STREAMINFO.
  if (sampleRateHz <= 0) return null;

  let md5 = '';
  for (let i = 18; i < 34; i++) md5 += body[i]!.toString(16).padStart(2, '0');
  // All-zero means the encoder did not compute it, which is not the same as a mismatch.
  if (/^0{32}$/.test(md5)) md5 = '';

  return {
    sampleRateHz,
    channels,
    bitsPerSample,
    totalSamples,
    durationSeconds: totalSamples > 0 ? totalSamples / sampleRateHz : 0,
    md5,
    minBlockSize,
    maxBlockSize,
  };
}

/**
 * Bitrate implied by the file size and the header's own duration, in kbps.
 *
 * Still an average — FLAC is variable rate, so there is no single true figure — but the duration
 * comes from the encoder rather than from a container's claim, which is what makes it worth more
 * than dividing by a duration something else asserted.
 */
export function flacBitrateKbps(info: FlacStreamInfo, fileBytes: number): number | undefined {
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) return undefined;
  if (info.durationSeconds <= 0) return undefined;
  const kbps = Math.round((fileBytes * 8) / info.durationSeconds / 1000);
  return kbps > 0 ? kbps : undefined;
}

/**
 * Uncompressed rate this audio would have had, in kbps.
 *
 * The honest comparison for a lossless file: 16-bit 44.1 kHz stereo is 1411 kbps, and a FLAC of
 * that material sits well below it while decoding to exactly those samples. Quoting the stored
 * rate alone invites the reading that a smaller number means worse audio, which for lossless is
 * backwards — it means the encoder did better.
 */
export function flacUncompressedKbps(info: FlacStreamInfo): number {
  return Math.round((info.sampleRateHz * info.bitsPerSample * info.channels) / 1000);
}

/** How much smaller the encode is than the raw audio, 0–1. */
export function flacCompressionRatio(
  info: FlacStreamInfo,
  fileBytes: number,
): number | undefined {
  const uncompressedBytes = (info.totalSamples * info.bitsPerSample * info.channels) / 8;
  if (uncompressedBytes <= 0 || !Number.isFinite(fileBytes) || fileBytes <= 0) return undefined;
  return fileBytes / uncompressedBytes;
}

/** True when the stream exceeds CD: more than 16 bits deep or faster than 48 kHz. */
export function isHighResolution(info: FlacStreamInfo): boolean {
  return info.bitsPerSample > 16 || info.sampleRateHz > 48_000;
}

/**
 * Badge text stating what the file is, e.g. "FLAC 24-bit 96 kHz".
 *
 * Depth and rate rather than a bitrate, because for a lossless file those are the properties that
 * determine what was captured; the encoded size is an artefact of how well it compressed.
 */
export function flacQualityLabel(info: FlacStreamInfo): string {
  const rate = info.sampleRateHz % 1000 === 0
    ? `${info.sampleRateHz / 1000} kHz`
    : `${(info.sampleRateHz / 1000).toFixed(1)} kHz`;
  return `FLAC ${info.bitsPerSample}-bit ${rate}`;
}
