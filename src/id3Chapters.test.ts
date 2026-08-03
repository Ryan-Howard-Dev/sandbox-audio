import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeId3Text,
  frameSize,
  frameSizeCandidates,
  parseChapFrame,
  readId3Chapters,
} from './id3Chapters';

/** ID3v2.3, three chapters, cover art after them. Written by ffmpeg, truncated to keep it small. */
const FIXTURE = readFileSync(join(import.meta.dirname, '__fixtures__', 'chaptered.mp3'));
const readFixture = async (offset: number, length: number) =>
  new Uint8Array(FIXTURE.subarray(offset, Math.min(offset + length, FIXTURE.length)));

/** The same book written as ID3v2.4, where frame sizes are syncsafe. */
const V4 = readFileSync(join(import.meta.dirname, '__fixtures__', 'chaptered-v4.mp3'));
const readV4 = async (offset: number, length: number) =>
  new Uint8Array(V4.subarray(offset, Math.min(offset + length, V4.length)));

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

describe('frameSize', () => {
  it('reads a plain size for ID3v2.3', () => {
    expect(frameSize(bytes(0, 0, 1, 0), 0, 3)).toBe(256);
  });

  it('reads a syncsafe size for ID3v2.4', () => {
    // 0x02 0x00 in syncsafe is 256, where a plain read would say 512.
    expect(frameSize(bytes(0, 0, 2, 0), 0, 4)).toBe(256);
  });

  it('takes a v2.4 size as plain when a byte proves it cannot be syncsafe', () => {
    /*
     * A syncsafe number never sets the top bit of any byte. Some v2.4 writers emit plain sizes
     * anyway, and trusting the version there walks into the middle of a frame.
     */
    expect(frameSize(bytes(0, 0, 0x80, 0), 0, 4)).toBe(0x8000);
  });
});

describe('frameSizeCandidates', () => {
  it('offers one reading for ID3v2.3, which is unambiguous', () => {
    expect(frameSizeCandidates(bytes(0, 0, 0x12, 0x63), 0, 3)).toEqual([0x1263]);
  });

  it('offers both readings for a v2.4 size, spec-correct first', () => {
    /*
     * This is ffmpeg's cover art frame, verbatim. 2403 read syncsafe, 4707 read plainly, and
     * nothing in the four bytes says which. Getting it wrong lands the walk inside the JPEG.
     */
    expect(frameSizeCandidates(bytes(0, 0, 0x12, 0x63), 0, 4)).toEqual([2403, 4707]);
  });

  it('offers one reading when both agree', () => {
    expect(frameSizeCandidates(bytes(0, 0, 0, 0x0f), 0, 4)).toEqual([15]);
  });
});

describe('decodeId3Text', () => {
  it('reads Latin-1, the default encoding', () => {
    expect(decodeId3Text(bytes(0, ...ascii('Chapter One')))).toBe('Chapter One');
  });

  it('reads UTF-8', () => {
    expect(decodeId3Text(bytes(3, ...ascii('Kapitel Eins')))).toBe('Kapitel Eins');
  });

  it('reads UTF-16 in either byte order, following the mark', () => {
    // "Ok" little-endian, then big-endian.
    expect(decodeId3Text(bytes(1, 0xff, 0xfe, 0x4f, 0x00, 0x6b, 0x00))).toBe('Ok');
    expect(decodeId3Text(bytes(1, 0xfe, 0xff, 0x00, 0x4f, 0x00, 0x6b))).toBe('Ok');
  });

  it('reads UTF-16 big-endian with no mark at all', () => {
    expect(decodeId3Text(bytes(2, 0x00, 0x4f, 0x00, 0x6b))).toBe('Ok');
  });

  it('drops the terminator rather than carrying it into the title', () => {
    expect(decodeId3Text(bytes(0, ...ascii('One'), 0, 0))).toBe('One');
  });

  it('returns nothing for an empty value', () => {
    expect(decodeId3Text(new Uint8Array(0))).toBe('');
    expect(decodeId3Text(bytes(0))).toBe('');
  });
});

describe('parseChapFrame', () => {
  /** element id, start ms, end ms, start offset, end offset, then a nested TIT2. */
  function chap(elementId: string, startMs: number, title?: string): Uint8Array {
    const head = [
      ...ascii(elementId),
      0,
      (startMs >>> 24) & 0xff,
      (startMs >>> 16) & 0xff,
      (startMs >>> 8) & 0xff,
      startMs & 0xff,
      0, 0, 0, 0,
      0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff,
    ];
    if (title === undefined) return bytes(...head);
    const text = [0, ...ascii(title)];
    return bytes(...head, ...ascii('TIT2'), 0, 0, 0, text.length, 0, 0, ...text);
  }

  it('reads the start time and the nested title', () => {
    expect(parseChapFrame(chap('ch1', 90_000, 'The Middle'), 3)).toEqual({
      startSeconds: 90,
      title: 'The Middle',
    });
  });

  it('reports a chapter with no title rather than inventing a number for it', () => {
    // Same refusal m4bChapters makes: the caller can number it, the parser must not.
    expect(parseChapFrame(chap('ch1', 5_000), 3)).toEqual({ startSeconds: 5, title: '' });
  });

  it('declines a frame whose start time is marked unset', () => {
    expect(parseChapFrame(chap('ch1', 0xffff_ffff, 'Nowhere'), 3)).toBeNull();
  });

  it('declines a frame with no element id terminator', () => {
    expect(parseChapFrame(bytes(...ascii('no-null-here')), 3)).toBeNull();
  });

  it('declines a frame that ends before its timings do', () => {
    expect(parseChapFrame(bytes(...ascii('ch1'), 0, 0, 0), 3)).toBeNull();
  });

  it('does not read a nested frame that claims to run past the chapter', () => {
    const frame = chap('ch1', 1_000, 'Fine');
    // Overstate the nested TIT2's size; the title is dropped, the chapter survives.
    frame[frame.length - 8] = 0x7f;
    expect(parseChapFrame(frame, 3)).toEqual({ startSeconds: 1, title: '' });
  });
});

describe('readId3Chapters on a file ffmpeg wrote', () => {
  it('finds every chapter, with its title and its offset', async () => {
    expect(
      (await readId3Chapters(readFixture, FIXTURE.length)).map((c) => [c.startSeconds, c.title]),
    ).toEqual([
      [0, 'One: The Opening'],
      [60, 'Two: The Middle'],
      [150, 'Three: The End'],
    ]);
  });

  it('steps over the cover art instead of reading it', async () => {
    let bytesRead = 0;
    await readId3Chapters(async (offset, length) => {
      bytesRead += Math.min(length, Math.max(0, FIXTURE.length - offset));
      return readFixture(offset, length);
    }, FIXTURE.length);
    /*
     * The APIC frame in this fixture is 2414 bytes and it sits after the chapters, so a walk that
     * reads bodies indiscriminately would pull it in. On the book this was written for the art is
     * 260kb of a 264kb tag, and the file is 845mb.
     */
    expect(bytesRead).toBeLessThan(500);
  });

  it('reports nothing for a file with no tag at all', async () => {
    const raw = async (offset: number, length: number) =>
      new Uint8Array(FIXTURE.subarray(3_000 + offset, 3_000 + offset + length));
    expect(await readId3Chapters(raw, 8_000)).toEqual([]);
  });

  it('stops at the end of what it can read rather than parsing past it', async () => {
    /*
     * A file cut off mid-tag. The first chapter ends at byte 184 and the second does not, so one
     * comes back and nothing is assembled out of bytes that were never there.
     *
     * One chapter is then discarded upstream, since a list of one is not navigation — see
     * audiobookChapterSource — so this degrades to the plain bar rather than to a wrong one.
     */
    const short = FIXTURE.subarray(0, 200);
    expect(
      await readId3Chapters(
        async (offset, length) =>
          new Uint8Array(short.subarray(offset, Math.min(offset + length, short.length))),
        short.length,
      ),
    ).toEqual([{ startSeconds: 0, title: 'One: The Opening' }]);
  });

  it('survives a reader that fails partway', async () => {
    let calls = 0;
    const flaky = async (offset: number, length: number) => {
      calls += 1;
      return calls > 2 ? null : readFixture(offset, length);
    };
    expect(await readId3Chapters(flaky, FIXTURE.length)).toEqual([]);
  });

  it('reads the same book written as ID3v2.4, where sizes are syncsafe', async () => {
    expect((await readId3Chapters(readV4, V4.length)).map((c) => [c.startSeconds, c.title])).toEqual(
      [
        [0, 'One: The Opening'],
        [60, 'Two: The Middle'],
        [150, 'Three: The End'],
      ],
    );
  });

  it('declines an unsynchronised tag instead of walking it wrong', async () => {
    const copy = Uint8Array.from(FIXTURE.subarray(0, 4_000));
    copy[5] = 0x80;
    expect(
      await readId3Chapters(
        async (offset, length) => copy.subarray(offset, Math.min(offset + length, copy.length)),
        copy.length,
      ),
    ).toEqual([]);
  });
});
