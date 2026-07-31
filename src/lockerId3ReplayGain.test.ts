import { describe, expect, it } from 'vitest';
import { parseId3v2Tags } from './lockerStorage';

const enc = new TextEncoder();

function synchsafe(size: number): number[] {
  return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
}

/** ID3v2.4 frame: 4-char id, synchsafe size, two flag bytes, payload. */
function frame(id: string, payload: number[]): number[] {
  return [...enc.encode(id), ...synchsafe(payload.length), 0, 0, ...payload];
}

/** TXXX payload: encoding byte, null-terminated description, value. */
function txxx(description: string, value: string, encoding = 3): number[] {
  const nul = encoding === 1 || encoding === 2 ? [0, 0] : [0];
  const encode = (s: string) =>
    encoding === 1
      ? [...new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer)]
      : [...enc.encode(s)];
  return [encoding, ...encode(description), ...nul, ...encode(value)];
}

function id3v2(frames: number[][]): ArrayBuffer {
  const body = frames.flat();
  return new Uint8Array([...enc.encode('ID3'), 4, 0, 0, ...synchsafe(body.length), ...body]).buffer;
}

describe('parseId3v2Tags — ReplayGain TXXX frames', () => {
  it('reads replaygain_track_gain and peak', () => {
    const tags = parseId3v2Tags(
      id3v2([
        frame('TIT2', [3, ...enc.encode('Test Track')]),
        frame('TXXX', txxx('replaygain_track_gain', '-7.25 dB')),
        frame('TXXX', txxx('replaygain_track_peak', '0.500000')),
      ]),
    );
    expect(tags.title).toBe('Test Track');
    expect(tags.replayGainTrackGainDb).toBe(-7.25);
    expect(tags.replayGainTrackPeakDbfs).toBe(-6);
  });

  it('matches the description case-insensitively, as taggers vary', () => {
    const tags = parseId3v2Tags(id3v2([frame('TXXX', txxx('REPLAYGAIN_TRACK_GAIN', '+3.1 dB'))]));
    expect(tags.replayGainTrackGainDb).toBe(3.1);
  });

  it('keeps the first value when a file carries duplicates', () => {
    const tags = parseId3v2Tags(
      id3v2([
        frame('TXXX', txxx('replaygain_track_gain', '-7.25 dB')),
        frame('TXXX', txxx('replaygain_track_gain', '-1.00 dB')),
      ]),
    );
    expect(tags.replayGainTrackGainDb).toBe(-7.25);
  });

  /*
   * A UTF-16 description ends in a two-byte null. Scanning byte-by-byte stops at the zero high
   * byte of the final character, splitting the description mid-way and silently losing the tag.
   */
  it('handles a UTF-16 description without truncating at the high byte', () => {
    const tags = parseId3v2Tags(id3v2([frame('TXXX', txxx('replaygain_track_gain', '-9.5 dB', 1))]));
    expect(tags.replayGainTrackGainDb).toBe(-9.5);
  });

  /*
   * Found while adding TXXX support: text frames were scanned for a one-byte terminator, so a
   * UTF-16 title stopped at the zero high byte of its first character. Windows Media Player and
   * older Mp3tag write UTF-16 by default, and those files imported as one-character titles.
   */
  it('decodes a UTF-16 title in full, not just its first character', () => {
    const utf16 = (s: string) => [
      ...new Uint8Array(new Uint16Array([0xfeff, ...[...s].map((c) => c.charCodeAt(0))]).buffer),
    ];
    const tags = parseId3v2Tags(id3v2([frame('TIT2', [1, ...utf16('Runaway')])]));
    expect(tags.title).toBe('Runaway');
  });

  it('ignores unrelated TXXX frames and does not fall over on them', () => {
    const tags = parseId3v2Tags(
      id3v2([
        frame('TXXX', txxx('MusicBrainz Album Id', 'abc-123')),
        frame('TXXX', txxx('replaygain_track_gain', 'not a number')),
        frame('TALB', [3, ...enc.encode('Album')]),
      ]),
    );
    expect(tags.replayGainTrackGainDb).toBeUndefined();
    expect(tags.album).toBe('Album');
  });
});
