import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SILENCE_THRESHOLD_DB,
  createSilenceScanner,
  scanForSilences,
  type SilenceSpan,
} from './silenceScan';
import { detectChapters, keywordWindows } from './spokenChapterDetect';

const RATE = 8_000;

/**
 * The fixture, as 16-bit mono PCM.
 *
 * Twelve seconds: tone, a three second pause, tone, a two and a half second pause, tone. The
 * pauses carry room tone rather than digital silence, because nothing that was recorded is ever
 * actually zero and a gate that only finds zero finds nothing outside a test.
 *
 * ffmpeg's own silencedetect was run against this exact file at the same threshold and reports
 * silences at 3.0 to 6.0 and 8.0 to 10.5. These tests are checked against that rather than against
 * my own arithmetic — the failure this guards is a scanner and its fixture agreeing with each
 * other, which is how the chpl bug survived thirteen passing tests.
 */
function fixturePcm(): Float32Array {
  const wav = readFileSync(join(import.meta.dirname, '__fixtures__', 'silences.wav'));
  // Canonical 44-byte header from the writer that produced it.
  const samples = (wav.length - 44) / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = wav.readInt16LE(44 + i * 2) / 32_768;
  return out;
}

/** A tone at a given amplitude, in samples. */
function tone(amplitude: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 180 * i) / RATE);
  }
  return out;
}

function quiet(seconds: number, amplitude = 0.0015): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * (i % 2 === 0 ? 1 : -1);
  return out;
}

/** Named concat, not join: `join` is already node:path's, and shadowing it broke every
 *  test that read the fixture. */
function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function rounded(spans: SilenceSpan[]): Array<[number, number]> {
  return spans.map((s) => [
    Math.round(s.startSeconds * 10) / 10,
    Math.round(s.endSeconds * 10) / 10,
  ]);
}

describe('against real audio, cross-checked with ffmpeg', () => {
  it('finds the same silences ffmpeg does', () => {
    // ffmpeg silencedetect at -45dB, d=2: 3.0 to 6.0, and 8.0 to 10.5.
    expect(rounded(scanForSilences([fixturePcm()], RATE))).toEqual([
      [3, 6],
      [8, 10.5],
    ]);
  });

  it('does not mistake room tone for sound', () => {
    /*
     * The pauses here are not digital black; they carry the kind of low-level noise every real
     * recording has. A gate at true zero would report no silences in this file at all, which is
     * what it would do on every real audiobook too.
     */
    expect(scanForSilences([fixturePcm()], RATE).length).toBe(2);
  });

  it('does not cut into the tone either side of a pause', () => {
    const [first] = scanForSilences([fixturePcm()], RATE);
    expect(first!.startSeconds).toBeGreaterThanOrEqual(2.9);
    expect(first!.endSeconds).toBeLessThanOrEqual(6.1);
  });
});

describe('what counts as a pause', () => {
  it('ignores a gap short enough to be punctuation', () => {
    // Sentence gaps run under a second; the default floor is two.
    const audio = concat(tone(0.25, 3), quiet(0.8), tone(0.25, 3));
    expect(scanForSilences([audio], RATE)).toEqual([]);
  });

  it('takes a gap long enough to be a break', () => {
    const audio = concat(tone(0.25, 3), quiet(2.5), tone(0.25, 3));
    expect(rounded(scanForSilences([audio], RATE))).toEqual([[3, 5.5]]);
  });

  it('honours a caller that wants a different floor', () => {
    const audio = concat(tone(0.25, 2), quiet(0.8), tone(0.25, 2));
    expect(
      rounded(scanForSilences([audio], RATE, { minSilenceSeconds: 0.5 })),
    ).toEqual([[2, 2.8]]);
  });

  it('honours a caller that wants a different threshold', () => {
    // At -80 the room tone in the fixture is no longer quiet, and nothing is found.
    expect(scanForSilences([fixturePcm()], RATE, { thresholdDb: -80 })).toEqual([]);
  });

  it('leaves quiet speech alone at the default threshold', () => {
    /*
     * A narrator speaking softly sits around -25 dBFS. The gate is twenty decibels below that, so
     * hushed delivery is never mistaken for a chapter break.
     */
    const soft = tone(0.05, 6); // about -29 dBFS
    expect(scanForSilences([soft], RATE)).toEqual([]);
    expect(DEFAULT_SILENCE_THRESHOLD_DB).toBeLessThan(-40);
  });
});

describe('edges', () => {
  it('reports a file that is silent from the start', () => {
    expect(rounded(scanForSilences([concat(quiet(3), tone(0.25, 3))], RATE))).toEqual([[0, 3]]);
  });

  it('reports a silence still open when the audio ends', () => {
    // A book ending in silence ends in a real one, and it is the span most likely to be a break.
    expect(rounded(scanForSilences([concat(tone(0.25, 3), quiet(3))], RATE))).toEqual([[3, 6]]);
  });

  it('finds nothing in an empty file', () => {
    expect(scanForSilences([new Float32Array(0)], RATE)).toEqual([]);
    expect(scanForSilences([], RATE)).toEqual([]);
  });

  it('survives a decoder handing it garbage', () => {
    const audio = concat(tone(0.25, 3), quiet(2.5), tone(0.25, 3));
    audio[100] = Number.NaN;
    audio[200] = Number.POSITIVE_INFINITY;
    // One NaN in a running sum would make every frame after it loud and hide every break.
    expect(rounded(scanForSilences([audio], RATE))).toEqual([[3, 5.5]]);
  });

  it('sums channels, since a break is silent on all of them', () => {
    const audio = concat(tone(0.25, 3), quiet(2.5), tone(0.25, 3));
    expect(rounded(scanForSilences([audio, audio], RATE))).toEqual([[3, 5.5]]);
  });
});

describe('streaming', () => {
  it('gives the same answer in ragged slices as in one piece', () => {
    // Thirty hours cannot be resident, and being cheap is the whole point of scanning first.
    const audio = fixturePcm();
    const scanner = createSilenceScanner(RATE);
    for (let offset = 0; offset < audio.length; offset += 999) {
      scanner.push([audio.subarray(offset, Math.min(offset + 999, audio.length))]);
    }
    expect(rounded(scanner.finish())).toEqual(rounded(scanForSilences([audio], RATE)));
  });
});

describe('feeding the chapter detector', () => {
  it('produces windows the keyword pass can use', () => {
    /*
     * The join this exists for. Silences become candidates, the spotter only listens at those, and
     * a hit inside one becomes a chapter starting where the pause ended.
     */
    const silences = scanForSilences([fixturePcm()], RATE);
    const windows = keywordWindows(silences, {
      minSilenceSeconds: 2,
      keywordWindowSeconds: 6,
      minScore: 0.5,
      minChapterSeconds: 1,
      maxChapters: 200,
    });
    expect(windows.map((w) => w.startSeconds)).toEqual([0, 6, 10.5]);
  });

  it('yields chapters once the spotter confirms them', () => {
    const silences = scanForSilences([fixturePcm()], RATE);
    const settings = {
      minSilenceSeconds: 2,
      keywordWindowSeconds: 6,
      minScore: 0.5,
      minChapterSeconds: 1,
      maxChapters: 200,
    };
    const found = detectChapters(
      {
        silences,
        hits: [
          { atSeconds: 0.5, keyword: 'chapter', score: 0.9 },
          { atSeconds: 6.5, keyword: 'chapter', score: 0.9 },
          { atSeconds: 11, keyword: 'chapter', score: 0.9 },
        ],
        durationSeconds: 12,
      },
      settings,
    );
    expect(found.map((c) => Math.round(c.startSeconds * 10) / 10)).toEqual([0, 6, 10.5]);
  });
});
