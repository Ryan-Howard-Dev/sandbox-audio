/**
 * Finding the long pauses in a recording, without a model.
 *
 * spokenChapterDetect needs candidate boundaries before the keyword spotter is worth running, and
 * the obvious way to get them is a voice activity detector — sherpa ships one, the app already
 * carries the engine, and Silero is two megabytes.
 *
 * It is the wrong tool here. A VAD earns its model by deciding whether a *sound* is speech: it
 * separates a talker from traffic, from music, from a room full of people. A chapter break is not
 * an ambiguous sound. It is the absence of one — two to four seconds where a produced audiobook
 * has nothing but room tone. Telling that from speech takes a threshold, not a neural network.
 *
 * So this is an energy gate: frame the audio, measure each frame, and call a run of quiet frames a
 * silence. It runs anywhere TypeScript runs, needs nothing downloaded, and can be tested against
 * real audio rather than against a model's opinion of it. Only the keyword half of the detector
 * still needs sherpa.
 *
 * Threshold rather than digital zero, deliberately. Silence in anything that was recorded rather
 * than generated is not zero: there is room tone, preamp hiss, and the noise floor of whatever it
 * was mastered on. A gate at true zero finds silence only in files that were synthesised, which is
 * to say in test fixtures and nowhere else.
 */

/** Matches the shape spokenChapterDetect consumes. */
export interface SilenceSpan {
  startSeconds: number;
  endSeconds: number;
}

export interface SilenceScanOptions {
  /**
   * Below this a frame counts as quiet, in dBFS.
   *
   * -45 sits under the noise floor of essentially any produced recording and above the floor of a
   * clean digital master, so it catches real pauses without cutting into quiet speech. A narrator
   * speaking softly is nowhere near this: conversational speech peaks around -12 and sits around
   * -25 even when hushed.
   */
  thresholdDb?: number;
  /** How long a frame is. Short enough to place a boundary precisely, long enough to be stable. */
  frameSeconds?: number;
  /** Runs shorter than this are punctuation between sentences, not breaks between parts. */
  minSilenceSeconds?: number;
}

export const DEFAULT_SILENCE_THRESHOLD_DB = -45;
export const DEFAULT_FRAME_SECONDS = 0.02;
export const DEFAULT_MIN_SILENCE_SECONDS = 2;

export interface SilenceScanner {
  /** Feed a slice. One Float32Array per channel, all the same length. */
  push(channels: readonly Float32Array[]): void;
  /** Every silence found, including one still open at the end of the audio. */
  finish(): SilenceSpan[];
}

/**
 * Scan for silences as the audio arrives.
 *
 * Streaming for the same reason the dynamic range analyser is: a thirty hour book cannot be
 * resident, and the whole point of doing this before the keyword pass is to be cheap.
 *
 * Channels are summed to mono before measuring. A chapter break is silent on every channel, and
 * measuring them separately would need a rule for what to do when they disagree — which only
 * happens for material that is not a pause.
 */
export function createSilenceScanner(
  sampleRate: number,
  options: SilenceScanOptions = {},
): SilenceScanner {
  const thresholdDb = options.thresholdDb ?? DEFAULT_SILENCE_THRESHOLD_DB;
  const frameSeconds = options.frameSeconds ?? DEFAULT_FRAME_SECONDS;
  const minSilenceSeconds = options.minSilenceSeconds ?? DEFAULT_MIN_SILENCE_SECONDS;

  const frameSamples = Math.max(1, Math.round(sampleRate * frameSeconds));
  /* Compared against mean square rather than its root, to keep a square root out of the loop. */
  const thresholdMeanSquare = Math.pow(10, thresholdDb / 10);

  const spans: SilenceSpan[] = [];
  let sumOfSquares = 0;
  let filled = 0;
  /** Frames consumed so far, which is the clock. */
  let framesDone = 0;
  /** Where the current run of quiet frames began, or null when the audio is not quiet. */
  let quietFrom: number | null = null;

  const secondsAt = (frames: number) => (frames * frameSamples) / sampleRate;

  function closeRun(endFrame: number): void {
    if (quietFrom === null) return;
    const startSeconds = secondsAt(quietFrom);
    const endSeconds = secondsAt(endFrame);
    if (endSeconds - startSeconds >= minSilenceSeconds) {
      spans.push({ startSeconds, endSeconds });
    }
    quietFrom = null;
  }

  function closeFrame(): void {
    const meanSquare = sumOfSquares / filled;
    sumOfSquares = 0;
    filled = 0;
    const quiet = meanSquare <= thresholdMeanSquare;
    if (quiet) {
      if (quietFrom === null) quietFrom = framesDone;
    } else {
      closeRun(framesDone);
    }
    framesDone += 1;
  }

  return {
    push(channels) {
      const first = channels[0];
      if (!first) return;
      const channelCount = channels.length;
      for (let i = 0; i < first.length; i += 1) {
        let mixed = 0;
        for (let c = 0; c < channelCount; c += 1) {
          const sample = channels[c]?.[i];
          // A NaN from a decoder would make every frame after it non-quiet, hiding every break.
          if (sample !== undefined && Number.isFinite(sample)) mixed += sample;
        }
        mixed /= channelCount;
        sumOfSquares += mixed * mixed;
        filled += 1;
        if (filled >= frameSamples) closeFrame();
      }
    },

    finish() {
      // A part-filled frame at the end still counts: a book ending in silence ends in a real
      // silence, and dropping it would lose the one span most likely to be the final break.
      if (filled > 0) closeFrame();
      closeRun(framesDone);
      return spans;
    },
  };
}

/** One-shot, for a caller holding the whole thing. */
export function scanForSilences(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: SilenceScanOptions = {},
): SilenceSpan[] {
  const scanner = createSilenceScanner(sampleRate, options);
  scanner.push(channels);
  return scanner.finish();
}
