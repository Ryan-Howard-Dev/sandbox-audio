import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFlacCuesheet,
  readFlacChapters,
  readFlacMetadataBlocks,
} from './flacCuesheet';

/**
 * A real FLAC carrying a real CUESHEET block.
 *
 * Built to the format specification and then checked against an independent implementation before
 * being trusted: ffmpeg's own FLAC demuxer reads this file and reports chapters at 0, 600 and 1500
 * seconds, and the audio still decodes clean. That check matters because the failure mode these
 * tests exist to prevent is a parser and its fixture agreeing with each other about a format both
 * have misread — which is exactly how the version 1 chpl bug survived thirteen passing tests.
 */
const FIXTURE = readFileSync(join(import.meta.dirname, '__fixtures__', 'cuesheet.flac'));
const read = async (offset: number, length: number) =>
  new Uint8Array(FIXTURE.subarray(offset, Math.min(offset + length, FIXTURE.length)));

describe('readFlacMetadataBlocks', () => {
  it('walks the whole chain', async () => {
    // STREAMINFO, VORBIS_COMMENT, PADDING, CUESHEET.
    const blocks = await readFlacMetadataBlocks(read, FIXTURE.length);
    expect(blocks.map((b) => b.type)).toEqual([0, 4, 1, 5]);
    expect(blocks[blocks.length - 1]!.isLast).toBe(true);
  });

  it('refuses a file that is not a FLAC', async () => {
    const notFlac = new Uint8Array(1_000);
    expect(
      await readFlacMetadataBlocks(
        async (o, l) => notFlac.subarray(o, o + l),
        notFlac.length,
      ),
    ).toEqual([]);
  });

  it('stops rather than walking past the end of a truncated file', async () => {
    const short = FIXTURE.subarray(0, 30);
    const blocks = await readFlacMetadataBlocks(
      async (o, l) => new Uint8Array(short.subarray(o, Math.min(o + l, short.length))),
      short.length,
    );
    expect(blocks.every((b) => b.nextOffset <= short.length)).toBe(true);
  });
});

describe('readFlacChapters', () => {
  it('finds the marks the cue sheet states', async () => {
    const chapters = await readFlacChapters(read, FIXTURE.length);
    expect(chapters.map((c) => Math.round(c.startSeconds))).toEqual([0, 600, 1500, 2400]);
  });

  it('leaves every chapter unnamed, because a cue sheet has nowhere to put a name', async () => {
    /*
     * A cue sheet track carries an offset, a number and an ISRC. Numbering them is the caller's
     * job; inventing "Chapter 4" here would be putting words in the file's mouth.
     */
    const chapters = await readFlacChapters(read, FIXTURE.length);
    expect(chapters.every((c) => c.title === '')).toBe(true);
  });

  it('drops the lead-out, which is where the audio stops rather than where a chapter starts', async () => {
    // The cue sheet has five entries; the last is the lead-out at 3000s and is not a chapter.
    const chapters = await readFlacChapters(read, FIXTURE.length);
    expect(chapters).toHaveLength(4);
    expect(chapters.every((c) => c.startSeconds < 3_000)).toBe(true);
  });

  it('reads the blocks it needs and steps over the rest', async () => {
    let bytesRead = 0;
    await readFlacChapters(async (o, l) => {
      bytesRead += Math.min(l, Math.max(0, FIXTURE.length - o));
      return read(o, l);
    }, FIXTURE.length);
    /*
     * Only STREAMINFO and CUESHEET are ever pulled across. A PICTURE block holding cover art is
     * routinely megabytes, and reaching a cue sheet behind it must not mean reading it.
     */
    expect(bytesRead).toBeLessThan(1_200);
  });

  it('says nothing for a FLAC with no cue sheet in it', async () => {
    // Strip the CUESHEET by marking the padding block as last.
    const stripped = Uint8Array.from(FIXTURE);
    const blocks = await readFlacMetadataBlocks(read, FIXTURE.length);
    const padding = blocks[2]!;
    stripped[padding.bodyOffset - 4] = 0x80 | padding.type;
    expect(
      await readFlacChapters(
        async (o, l) => stripped.subarray(o, Math.min(o + l, stripped.length)),
        stripped.length,
      ),
    ).toEqual([]);
  });
});

describe('parseFlacCuesheet', () => {
  /** Build a payload the way the format states it, for the cases the fixture cannot cover. */
  function cuesheet(
    tracks: Array<{ sample: number; number: number; indexPoints?: number }>,
  ): Uint8Array {
    const TRACK = 36;
    // Sized from the index points each track actually declares. Assuming one apiece under-allocates
    // and the parser then correctly refuses to read past the end — which looks like a parser bug
    // and is a fixture bug.
    const bytes = tracks.reduce(
      (sum, track) => sum + TRACK + (track.indexPoints ?? 1) * 12,
      396,
    );
    const body = new Uint8Array(bytes);
    const view = new DataView(body.buffer);
    body[395] = tracks.length;
    let at = 396;
    for (const track of tracks) {
      const points = track.indexPoints ?? 1;
      view.setUint32(at, Math.floor(track.sample / 4_294_967_296));
      view.setUint32(at + 4, track.sample >>> 0);
      body[at + 8] = track.number;
      body[at + 35] = points;
      at += TRACK + points * 12;
    }
    return body.subarray(0, at);
  }

  it('converts sample offsets with the stream rate', () => {
    const parsed = parseFlacCuesheet(
      cuesheet([
        { sample: 0, number: 1 },
        { sample: 44_100 * 90, number: 2 },
      ]),
      44_100,
    );
    expect(parsed.map((c) => c.startSeconds)).toEqual([0, 90]);
  });

  it('is exact at rates where milliseconds would round', () => {
    // Sample accuracy is the one thing this format has over the other two chapter carriers.
    const parsed = parseFlacCuesheet(
      cuesheet([
        { sample: 0, number: 1 },
        { sample: 1, number: 2 },
      ]),
      44_100,
    );
    expect(parsed[1]!.startSeconds).toBeCloseTo(1 / 44_100, 12);
  });

  it('walks past tracks with several index points', () => {
    /*
     * Index points are variable-length payload inside each track. Assuming one would put the
     * reader a few bytes into the middle of the next track and produce nonsense offsets.
     */
    const parsed = parseFlacCuesheet(
      cuesheet([
        { sample: 0, number: 1, indexPoints: 3 },
        { sample: 44_100 * 60, number: 2, indexPoints: 1 },
      ]),
      44_100,
    );
    expect(parsed.map((c) => c.startSeconds)).toEqual([0, 60]);
  });

  it('drops a CD lead-out as well as a non-CD one', () => {
    const parsed = parseFlacCuesheet(
      cuesheet([
        { sample: 0, number: 1 },
        { sample: 44_100 * 10, number: 170 },
      ]),
      44_100,
    );
    expect(parsed).toHaveLength(1);
  });

  it('says nothing without a sample rate to divide by', () => {
    // Offsets are sample counts, so they mean nothing on their own.
    expect(parseFlacCuesheet(cuesheet([{ sample: 0, number: 1 }]), 0)).toEqual([]);
  });

  it('returns what it read when the block is truncated mid-track', () => {
    const full = cuesheet([
      { sample: 0, number: 1 },
      { sample: 44_100 * 60, number: 2 },
    ]);
    const cut = full.subarray(0, full.length - 20);
    expect(parseFlacCuesheet(cut, 44_100).map((c) => c.startSeconds)).toEqual([0]);
  });

  it('says nothing for a block with no tracks', () => {
    expect(parseFlacCuesheet(cuesheet([]), 44_100)).toEqual([]);
    expect(parseFlacCuesheet(new Uint8Array(10), 44_100)).toEqual([]);
  });
});
