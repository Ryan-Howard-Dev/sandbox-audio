import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readM4bChapters } from './m4bChapters';

/**
 * The parser against a file an encoder actually wrote.
 *
 * The other tests build the atoms they then parse, which proves the parse and quietly assumes the
 * layout. That assumption was wrong for the commonest kind of M4B there is: the fixture here is
 * four minutes of silence with three chapters, written by ffmpeg, and the parser returned nothing
 * for it. ffmpeg writes a version 1 chpl payload, which puts four reserved bytes between the flags
 * and the chapter count, and reading it as version 0 finds a count of zero and gives up. Every
 * ffmpeg-made audiobook came back with no chapters, which is indistinguishable from a book that
 * genuinely has none — so nothing ever suggested a fault.
 *
 * It exercises the walk as well as the parse. moov sits at 21164 and chpl at 43249, so reaching
 * the chapter table means stepping over mdat by its declared size, which is what makes this cost
 * kilobytes on a book that is gigabytes.
 */
describe('readM4bChapters on a file ffmpeg wrote', () => {
  const bytes = readFileSync(join(import.meta.dirname, '__fixtures__', 'chaptered.m4b'));
  const read = async (offset: number, length: number) =>
    new Uint8Array(bytes.subarray(offset, Math.min(offset + length, bytes.length)));

  it('finds every chapter, with its title and its offset', async () => {
    const chapters = await readM4bChapters(read, bytes.length);
    expect(chapters.map((c) => [Math.round(c.startSeconds), c.title])).toEqual([
      [0, 'One: The Opening'],
      [60, 'Two: The Middle'],
      [150, 'Three: The End'],
    ]);
  });

  it('reads headers and the chapter table, never the audio', async () => {
    let bytesRead = 0;
    await readM4bChapters(async (offset, length) => {
      bytesRead += Math.min(length, Math.max(0, bytes.length - offset));
      return read(offset, length);
    }, bytes.length);
    // mdat alone is 21kb of this 43kb file, and a real book is gigabytes. If this ever starts
    // reading the audio, it will do so on a nine-hour file too.
    expect(bytesRead).toBeLessThan(2_048);
  });

  it('reports nothing rather than guessing when the table is truncated', async () => {
    const short = bytes.subarray(0, bytes.length - 60);
    const chapters = await readM4bChapters(
      async (offset, length) =>
        new Uint8Array(short.subarray(offset, Math.min(offset + length, short.length))),
      short.length,
    );
    expect(chapters).toEqual([]);
  });
});
