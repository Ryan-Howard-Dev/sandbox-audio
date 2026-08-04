/**
 * How much loud and quiet a recording actually has left.
 *
 * The fidelity badge answers "is this lossless", which is a question about the container and not
 * about the music. A 24-bit master squashed flat in the loudness war is lossless and sounds worse
 * than a careful CD rip; nothing on the screen can currently tell those apart. ReplayGain cannot
 * help either — it measures how loud a track is so playback can even it out, which is a different
 * question from how much range the track has.
 *
 * DR is the number that separates them. It comes from the Pleasurize Music Foundation meter, and
 * the shape of it is: take the loudest fifth of the track and ask how far the peaks sit above it.
 * A recording with real dynamics has peaks well clear of its own loud passages; a crushed one has
 * everything jammed against the ceiling and nowhere left to go.
 *
 * Written here rather than bound to the Rust tool because that one is a Tauri desktop app, and the
 * fidelity badge appears on the phone too. This is arithmetic over samples: it belongs somewhere
 * both platforms can run it.
 *
 * Streaming on purpose. Five minutes of stereo at 44.1 kHz is about 26 million floats, which is a
 * hundred megabytes resident if the caller has to hand over the whole track at once. Audio arrives
 * in slices from every decoder worth using, so this consumes slices and keeps only one block.
 */

/** Three seconds is the measurement window the meter is defined against. */
export const DR_BLOCK_SECONDS = 3;
/** The loudest fifth of the track is what the reading is taken from. */
export const DR_LOUDEST_FRACTION = 0.2;

export interface DynamicRangeResult {
  /** The DR figure as meters report it: a whole number, higher is more dynamic. */
  dr: number;
  /** Per channel, unrounded, for anything that wants to show the two sides of a stereo mix. */
  perChannel: number[];
  /** How many full blocks were measured. Few blocks means a shakier reading. */
  blocks: number;
  /** Loudest single sample, in dBFS. 0 means it touches the ceiling. */
  peakDb: number;
}

export interface DynamicRangeOptions {
  blockSeconds?: number;
  loudestFraction?: number;
}

/**
 * Root mean square, with the factor of two the meter is defined with.
 *
 * Not a mistake and not a convention this file invented. The published algorithm scales so that a
 * full-scale sine reads 1.0 rather than 0.707, which puts RMS and peak on the same footing for a
 * sine and makes the DR of one exactly zero. Drop the two and every number this produces is 3 dB
 * away from what every other meter says about the same file.
 */
function blockRms(sumOfSquares: number, sampleCount: number): number {
  if (sampleCount <= 0) return 0;
  return Math.sqrt((2 * sumOfSquares) / sampleCount);
}

interface ChannelState {
  /** RMS of each completed block. */
  rms: number[];
  /** Peak of each completed block. */
  peaks: number[];
  /** Running totals for the block being filled. */
  sumOfSquares: number;
  peak: number;
  filled: number;
}

export interface DynamicRangeAnalyser {
  /**
   * Feed one slice. One Float32Array per channel, all the same length.
   *
   * Channel count is fixed at creation: a decoder that changes it mid-track is describing two
   * different recordings, and averaging across the change would report a number about neither.
   */
  push(channels: readonly Float32Array[]): void;
  /** The reading, or null when there was not enough audio to take one. */
  finish(): DynamicRangeResult | null;
}

export function createDynamicRangeAnalyser(
  channelCount: number,
  sampleRate: number,
  options: DynamicRangeOptions = {},
): DynamicRangeAnalyser {
  const blockSeconds = options.blockSeconds ?? DR_BLOCK_SECONDS;
  const loudestFraction = options.loudestFraction ?? DR_LOUDEST_FRACTION;
  const blockSamples = Math.max(1, Math.round(sampleRate * blockSeconds));

  const channels: ChannelState[] = Array.from({ length: Math.max(0, channelCount) }, () => ({
    rms: [],
    peaks: [],
    sumOfSquares: 0,
    peak: 0,
    filled: 0,
  }));

  function closeBlock(state: ChannelState): void {
    state.rms.push(blockRms(state.sumOfSquares, state.filled));
    state.peaks.push(state.peak);
    state.sumOfSquares = 0;
    state.peak = 0;
    state.filled = 0;
  }

  return {
    push(incoming) {
      for (let c = 0; c < channels.length; c += 1) {
        const state = channels[c]!;
        const data = incoming[c];
        if (!data) continue;
        for (let i = 0; i < data.length; i += 1) {
          const sample = data[i]!;
          // Guard rather than trust: one NaN from a decoder would poison the whole running sum
          // and take the reading with it.
          if (!Number.isFinite(sample)) continue;
          state.sumOfSquares += sample * sample;
          const magnitude = Math.abs(sample);
          if (magnitude > state.peak) state.peak = magnitude;
          state.filled += 1;
          if (state.filled >= blockSamples) closeBlock(state);
        }
      }
    },

    finish() {
      /*
       * A part-filled block at the end is discarded. Its RMS is taken over however many samples
       * happened to be left, so a track ending a quarter of a second after a block boundary would
       * contribute a reading from a quarter second of audio weighted the same as three seconds of
       * it. At most three seconds is lost from a measurement that needs minutes.
       */
      const perChannel: number[] = [];
      let blocks = 0;
      let peak = 0;

      for (const state of channels) {
        for (const p of state.peaks) if (p > peak) peak = p;
        if (state.peak > peak) peak = state.peak;

        /*
         * Two blocks minimum, because the reading is taken against the *second* highest peak. One
         * block has no second peak, and using its only one would compare a block against itself.
         */
        if (state.rms.length < 2) continue;
        blocks = Math.max(blocks, state.rms.length);

        const loudestRms = [...state.rms].sort((a, b) => b - a);
        const take = Math.max(1, Math.round(loudestFraction * loudestRms.length));
        let sum = 0;
        for (let i = 0; i < take; i += 1) sum += loudestRms[i]! * loudestRms[i]!;
        const rms20 = Math.sqrt(sum / take);

        const sortedPeaks = [...state.peaks].sort((a, b) => b - a);
        const secondPeak = sortedPeaks[1]!;

        /*
         * Silence has no dynamic range to report, and neither has a channel whose loud passages
         * measure nothing. Returning a huge number for a digital-black channel would put a silent
         * track at the top of any "most dynamic" list ever built on this.
         */
        if (!(rms20 > 0) || !(secondPeak > 0)) continue;

        /*
         * Clamped at zero. The factor-of-two RMS lets a waveform flatter than a sine — a square
         * wave, a heavily clipped master — measure an RMS above its own peak, which comes out
         * negative. Negative dynamic range is not a thing; zero is the meter's floor and what
         * every other tool reports for those.
         */
        perChannel.push(Math.max(0, 20 * Math.log10(secondPeak / rms20)));
      }

      if (perChannel.length === 0) return null;

      const mean = perChannel.reduce((a, b) => a + b, 0) / perChannel.length;
      return {
        dr: Math.round(mean),
        perChannel,
        blocks,
        peakDb: peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY,
      };
    },
  };
}

/** One-shot, for a caller that already holds the whole track. */
export function analyseDynamicRange(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: DynamicRangeOptions = {},
): DynamicRangeResult | null {
  const analyser = createDynamicRangeAnalyser(channels.length, sampleRate, options);
  analyser.push(channels);
  return analyser.finish();
}

/**
 * What a DR figure means, in words a listener can act on.
 *
 * The bands are the ones the meter's own campaign published, and they are about mastering rather
 * than about the music: a DR5 record is not a bad record, it is a record mastered to be loud. The
 * badge should say what was measured and let the listener decide what to think of it.
 */
export type DynamicRangeVerdict = 'crushed' | 'compressed' | 'moderate' | 'wide';

export function dynamicRangeVerdict(dr: number): DynamicRangeVerdict {
  if (!Number.isFinite(dr)) return 'moderate';
  if (dr <= 7) return 'crushed';
  if (dr <= 11) return 'compressed';
  if (dr <= 13) return 'moderate';
  return 'wide';
}

/** Enough audio to be worth measuring at all. Below this the reading is noise. */
export function hasEnoughAudioForDynamicRange(
  durationSeconds: number,
  blockSeconds: number = DR_BLOCK_SECONDS,
): boolean {
  return Number.isFinite(durationSeconds) && durationSeconds >= blockSeconds * 2;
}
