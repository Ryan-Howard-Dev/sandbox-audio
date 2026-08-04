import { describe, expect, it } from 'vitest';
import {
  analyseDynamicRange,
  createDynamicRangeAnalyser,
  dynamicRangeVerdict,
  hasEnoughAudioForDynamicRange,
} from './dynamicRange';

/** Low rate keeps the tests instant; the algorithm has no opinion about sample rate. */
const RATE = 1_000;
const BLOCK = RATE * 3;

/** A sine at a given amplitude, `blocks` three-second blocks long. */
function sine(amplitude: number, blocks: number): Float32Array {
  const out = new Float32Array(BLOCK * blocks);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 50 * i) / RATE);
  }
  return out;
}

/** The same, with one full-scale sample dropped into every block. */
function sineWithTransients(amplitude: number, blocks: number, peak = 1): Float32Array {
  const out = sine(amplitude, blocks);
  for (let b = 0; b < blocks; b += 1) out[b * BLOCK + 10] = peak;
  return out;
}

describe('a sine has no dynamic range', () => {
  it('reads zero, because its peak and its RMS are the same thing', () => {
    /*
     * The published algorithm scales RMS so a full-scale sine reads 1.0 rather than 0.707. That
     * makes this case exactly zero, which is the cleanest check there is that the scaling is right
     * — drop the factor of two and this comes out at 3.
     */
    const result = analyseDynamicRange([sine(1, 10)], RATE)!;
    expect(result.dr).toBe(0);
  });

  it('reads the same whatever the volume, because DR is not loudness', () => {
    // The whole point of measuring range rather than level: turning a record down does not give
    // it back its dynamics.
    const loud = analyseDynamicRange([sine(1, 10)], RATE)!;
    const quiet = analyseDynamicRange([sine(0.05, 10)], RATE)!;
    expect(quiet.perChannel[0]).toBeCloseTo(loud.perChannel[0]!, 6);
  });
});

describe('peaks above the loud passages', () => {
  it('measures how far the transients sit above the body of the track', () => {
    /*
     * A 0.1 sine reads RMS 0.1 under this scaling, so a full-scale transient sits ten times above
     * it: 20 dB.
     *
     * It measures 19.72 rather than a clean 20 because the transient is itself part of the block
     * it is being compared against — one full-scale sample among three thousand lifts that block's
     * RMS from 0.1000 to 0.1033. Real music does the same thing, which is why the meter's numbers
     * are whole ones.
     */
    const result = analyseDynamicRange([sineWithTransients(0.1, 10)], RATE)!;
    expect(result.perChannel[0]).toBeCloseTo(19.7, 1);
    expect(result.dr).toBe(20);
  });

  it('reports less range as the transients are pulled down toward the body', () => {
    const wide = analyseDynamicRange([sineWithTransients(0.1, 10, 1)], RATE)!;
    const narrow = analyseDynamicRange([sineWithTransients(0.1, 10, 0.3)], RATE)!;
    const crushed = analyseDynamicRange([sineWithTransients(0.1, 10, 0.12)], RATE)!;
    expect(wide.dr).toBeGreaterThan(narrow.dr);
    expect(narrow.dr).toBeGreaterThan(crushed.dr);
  });

  it('takes its reading from the loudest fifth, not from the quiet stretches', () => {
    /*
     * Eight quiet blocks and two loud ones. Averaging all ten would report a far wider range than
     * the record has; the meter deliberately looks only at where the music actually is.
     */
    const quiet = sineWithTransients(0.01, 8);
    const loud = sineWithTransients(0.5, 2);
    const joined = new Float32Array(quiet.length + loud.length);
    joined.set(quiet, 0);
    joined.set(loud, quiet.length);
    const result = analyseDynamicRange([joined], RATE)!;
    // Against the loud blocks' RMS of 0.5, a full-scale peak is 6 dB. Against the quiet ones it
    // would have been 40.
    expect(result.perChannel[0]).toBeCloseTo(6, 0);
  });
});

describe('the second peak, not the first', () => {
  it('ignores a single stray sample that no other block matches', () => {
    /*
     * One rogue sample — a click, a decode glitch — would otherwise set the reference for the
     * whole track and inflate its DR. The meter uses the second highest peak for exactly this.
     */
    const clean = sineWithTransients(0.1, 10, 0.5);
    const withClick = Float32Array.from(clean);
    withClick[BLOCK * 4 + 500] = 1;
    const a = analyseDynamicRange([clean], RATE)!;
    const b = analyseDynamicRange([withClick], RATE)!;
    expect(b.dr).toBe(a.dr);
  });
});

describe('what it refuses to answer', () => {
  it('declines a track with only one block to measure', () => {
    // There is no second peak in one block, and comparing a block against itself is not a reading.
    expect(analyseDynamicRange([sine(0.5, 1)], RATE)).toBeNull();
  });

  it('declines silence rather than reporting infinite range', () => {
    // A digital-black file would otherwise top any "most dynamic" list built on this.
    expect(analyseDynamicRange([new Float32Array(BLOCK * 10)], RATE)).toBeNull();
  });

  it('declines when there are no channels at all', () => {
    expect(analyseDynamicRange([], RATE)).toBeNull();
  });

  it('never reports negative range', () => {
    /*
     * A square wave is flatter than a sine, so under this scaling its RMS exceeds its own peak and
     * the logarithm goes negative. Negative dynamic range is not a thing; zero is the floor.
     */
    const square = new Float32Array(BLOCK * 10);
    for (let i = 0; i < square.length; i += 1) square[i] = i % 20 < 10 ? 1 : -1;
    const result = analyseDynamicRange([square], RATE)!;
    expect(result.dr).toBe(0);
    expect(result.perChannel[0]).toBeGreaterThanOrEqual(0);
  });

  it('survives a decoder handing it garbage', () => {
    const data = sineWithTransients(0.1, 10);
    data[100] = Number.NaN;
    data[200] = Number.POSITIVE_INFINITY;
    const result = analyseDynamicRange([data], RATE)!;
    // One NaN in a running sum would take the whole reading with it.
    expect(Number.isFinite(result.dr)).toBe(true);
    expect(result.dr).toBeCloseTo(20, 0);
  });
});

describe('streaming', () => {
  it('gives the same answer fed in slices as fed whole', () => {
    // The reason this is streaming at all: five minutes of stereo is a hundred megabytes of float.
    const whole = sineWithTransients(0.1, 12);
    const oneShot = analyseDynamicRange([whole], RATE)!;

    const analyser = createDynamicRangeAnalyser(1, RATE);
    // Deliberately ragged slices that do not line up with block boundaries.
    for (let offset = 0; offset < whole.length; offset += 777) {
      analyser.push([whole.subarray(offset, Math.min(offset + 777, whole.length))]);
    }
    const streamed = analyser.finish()!;
    expect(streamed.perChannel[0]).toBeCloseTo(oneShot.perChannel[0]!, 6);
    expect(streamed.blocks).toBe(oneShot.blocks);
  });

  it('drops the part-filled block at the end rather than weighting it as a whole one', () => {
    const analyser = createDynamicRangeAnalyser(1, RATE);
    analyser.push([sineWithTransients(0.1, 4)]);
    // Half a block of near-silence, which as a full block would drag the reading about.
    analyser.push([new Float32Array(BLOCK / 2)]);
    expect(analyser.finish()!.blocks).toBe(4);
  });
});

describe('stereo', () => {
  it('measures each channel and reports their average', () => {
    const wide = sineWithTransients(0.1, 10);
    const narrow = sineWithTransients(0.5, 10);
    const result = analyseDynamicRange([wide, narrow], RATE)!;
    expect(result.perChannel).toHaveLength(2);
    expect(result.perChannel[0]).toBeGreaterThan(result.perChannel[1]!);
    expect(result.dr).toBe(
      Math.round((result.perChannel[0]! + result.perChannel[1]!) / 2),
    );
  });

  it('reports the loudest sample across every channel', () => {
    const left = sine(0.2, 10);
    const right = sineWithTransients(0.2, 10, 1);
    expect(analyseDynamicRange([left, right], RATE)!.peakDb).toBeCloseTo(0, 5);
  });
});

describe('dynamicRangeVerdict', () => {
  it('names the bands the meter campaign published', () => {
    expect(dynamicRangeVerdict(4)).toBe('crushed');
    expect(dynamicRangeVerdict(7)).toBe('crushed');
    expect(dynamicRangeVerdict(8)).toBe('compressed');
    expect(dynamicRangeVerdict(11)).toBe('compressed');
    expect(dynamicRangeVerdict(12)).toBe('moderate');
    expect(dynamicRangeVerdict(14)).toBe('wide');
    expect(dynamicRangeVerdict(20)).toBe('wide');
  });

  it('does not guess at a number that is not one', () => {
    expect(dynamicRangeVerdict(Number.NaN)).toBe('moderate');
  });
});

describe('hasEnoughAudioForDynamicRange', () => {
  it('wants at least two blocks before it is worth decoding anything', () => {
    expect(hasEnoughAudioForDynamicRange(6)).toBe(true);
    expect(hasEnoughAudioForDynamicRange(5.9)).toBe(false);
    expect(hasEnoughAudioForDynamicRange(Number.NaN)).toBe(false);
  });
});
