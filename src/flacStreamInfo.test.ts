import { describe, expect, it } from 'vitest';
import {
  flacBitrateKbps,
  flacCompressionRatio,
  flacQualityLabel,
  flacUncompressedKbps,
  isHighResolution,
  parseFlacStreamInfo,
} from './flacStreamInfo';

/*
 * STREAMINFO states what the encoder wrote, so these fixtures are built bit by bit exactly as the
 * format specifies. The fields straddle byte boundaries — sample rate is 20 bits, channels 3,
 * depth 5, total samples 36 — which is where a hand-rolled reader goes wrong, so the tests use
 * awkward real-world values rather than ones that happen to align.
 */
function buildStreamInfo(options: {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  totalSamples: number;
  md5?: number[];
  withId3?: boolean;
}): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push(Math.floor(value / 2 ** i) % 2);
  };

  push(4096, 16); // min block size
  push(4096, 16); // max block size
  push(0, 24); // min frame size
  push(0, 24); // max frame size
  push(options.sampleRateHz, 20);
  push(options.channels - 1, 3);
  push(options.bitsPerSample - 1, 5);
  push(options.totalSamples, 36);

  const body = new Uint8Array(34);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 1) body[i >> 3]! |= 1 << (7 - (i & 7));
  }
  const md5 = options.md5 ?? new Array(16).fill(0).map((_, i) => i + 1);
  body.set(md5, 18);

  const header = new Uint8Array([0x80, 0x00, 0x00, 0x22]); // last block, type 0, length 34
  const marker = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);

  const flac = new Uint8Array(marker.length + header.length + body.length);
  flac.set(marker, 0);
  flac.set(header, marker.length);
  flac.set(body, marker.length + header.length);
  if (!options.withId3) return flac;

  // ID3v2 header with a syncsafe size of 10 bytes of padding.
  const id3 = new Uint8Array(20);
  id3.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a], 0);
  const out = new Uint8Array(id3.length + flac.length);
  out.set(id3, 0);
  out.set(flac, id3.length);
  return out;
}

const cdQuality = () =>
  buildStreamInfo({ sampleRateHz: 44_100, channels: 2, bitsPerSample: 16, totalSamples: 4_410_000 });

describe('parseFlacStreamInfo', () => {
  it('reads a CD-quality header', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    expect(info.sampleRateHz).toBe(44_100);
    expect(info.channels).toBe(2);
    expect(info.bitsPerSample).toBe(16);
    expect(info.totalSamples).toBe(4_410_000);
    expect(info.durationSeconds).toBeCloseTo(100, 5);
  });

  /* 24-bit at 96 kHz exercises the 5-bit depth and 20-bit rate fields at awkward offsets. */
  it('reads a high-resolution header', () => {
    const info = parseFlacStreamInfo(
      buildStreamInfo({ sampleRateHz: 96_000, channels: 2, bitsPerSample: 24, totalSamples: 9_600_000 }),
    )!;
    expect(info.sampleRateHz).toBe(96_000);
    expect(info.bitsPerSample).toBe(24);
    expect(isHighResolution(info)).toBe(true);
    expect(flacQualityLabel(info)).toBe('FLAC 24-bit 96 kHz');
  });

  /* Total samples is 36 bits — wider than a 32-bit shift, which is where naive readers break. */
  it('reads a total-sample count beyond 32 bits', () => {
    const huge = 40_000_000_000;
    const info = parseFlacStreamInfo(
      buildStreamInfo({ sampleRateHz: 44_100, channels: 2, bitsPerSample: 16, totalSamples: huge }),
    )!;
    expect(info.totalSamples).toBe(huge);
  });

  it('reads the audio MD5 as hex', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    expect(info.md5).toBe('0102030405060708090a0b0c0d0e0f10');
  });

  /* An unset MD5 is "not computed", which is not the same as a mismatch. */
  it('reports an unset MD5 as empty rather than a run of zeroes', () => {
    const info = parseFlacStreamInfo(
      buildStreamInfo({
        sampleRateHz: 44_100,
        channels: 2,
        bitsPerSample: 16,
        totalSamples: 1_000,
        md5: new Array(16).fill(0),
      }),
    )!;
    expect(info.md5).toBe('');
  });

  /* Taggers prepend ID3 to FLAC constantly; insisting on "fLaC" at byte zero rejects real files. */
  it('finds the stream behind a prepended ID3 tag', () => {
    const info = parseFlacStreamInfo(
      buildStreamInfo({
        sampleRateHz: 44_100,
        channels: 2,
        bitsPerSample: 16,
        totalSamples: 1_000,
        withId3: true,
      }),
    );
    expect(info?.sampleRateHz).toBe(44_100);
  });

  it('reports zero duration when the encoder did not know the length', () => {
    const info = parseFlacStreamInfo(
      buildStreamInfo({ sampleRateHz: 44_100, channels: 2, bitsPerSample: 16, totalSamples: 0 }),
    )!;
    expect(info.totalSamples).toBe(0);
    expect(info.durationSeconds).toBe(0);
  });

  it('returns null for anything that is not a FLAC file', () => {
    expect(parseFlacStreamInfo(new Uint8Array([0x49, 0x44, 0x33, 0x04]))).toBeNull();
    expect(parseFlacStreamInfo(new Uint8Array(0))).toBeNull();
    expect(parseFlacStreamInfo(new Uint8Array([0x66, 0x4c, 0x61, 0x43]))).toBeNull();
  });

  it('accepts an ArrayBuffer as well as a view', () => {
    const bytes = cdQuality();
    const copy = bytes.slice().buffer;
    expect(parseFlacStreamInfo(copy)?.sampleRateHz).toBe(44_100);
  });
});

describe('derived figures', () => {
  it('states the uncompressed rate CD audio would have had', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    expect(flacUncompressedKbps(info)).toBe(1_411);
  });

  it('computes an average bitrate from the header duration', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    // 10 MB over 100 s.
    expect(flacBitrateKbps(info, 10_000_000)).toBe(800);
  });

  /*
   * The comparison that matters for lossless: a smaller encode is the encoder doing better, not
   * worse audio. Quoting the stored rate alone invites exactly the wrong reading.
   */
  it('reports compression as a fraction of the raw audio', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    const raw = (4_410_000 * 16 * 2) / 8;
    expect(flacCompressionRatio(info, raw / 2)).toBeCloseTo(0.5, 5);
  });

  it('declines to guess when the size or duration is unusable', () => {
    const info = parseFlacStreamInfo(cdQuality())!;
    expect(flacBitrateKbps(info, 0)).toBeUndefined();
    expect(flacCompressionRatio(info, -1)).toBeUndefined();
  });

  it('does not call CD quality high resolution', () => {
    expect(isHighResolution(parseFlacStreamInfo(cdQuality())!)).toBe(false);
  });

  it('formats a non-round sample rate without losing it', () => {
    const info = parseFlacStreamInfo(
      buildStreamInfo({ sampleRateHz: 88_200, channels: 2, bitsPerSample: 24, totalSamples: 100 }),
    )!;
    expect(flacQualityLabel(info)).toBe('FLAC 24-bit 88.2 kHz');
  });
});
