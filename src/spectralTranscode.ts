/**
 * Transcode detection by spectral analysis.
 *
 * A lossless container proves nothing about what went into it. A 128 kbps MP3 re-encoded to FLAC
 * carries the .flac extension, the ~1411 kbps nominal rate and the file size of a real CD rip,
 * while sounding exactly like the MP3 it came from. It is the same lie as a hardcoded bitrate,
 * one layer down: a number that describes the container rather than the audio.
 *
 * Lossy encoders discard high frequencies permanently. Re-encoding to FLAC describes the resulting
 * silence with mathematical precision, so the gap stays, and it is visible: energy stops dead at a
 * frequency the encoder chose. That edge is what this module measures.
 *
 * The hard part, and the part most tools get wrong, is that a low cutoff is not proof. A vinyl
 * rip, a 1950s jazz recording or a deliberately muffled mix can genuinely hold nothing above
 * 16 kHz, and calling those fakes is worse than missing a transcode — it accuses a listener's
 * legitimate file. So the *shape* of the edge decides, not its position: an encoder leaves a
 * brickwall, physics leaves a slope.
 */

/** Frames of this size give ~10 Hz resolution at 44.1 kHz, fine enough to place an edge. */
export const SPECTRAL_FFT_SIZE = 4096;

/** Anything quieter than this is treated as absence of signal rather than quiet signal. */
export const SPECTRAL_NOISE_FLOOR_DB = -90;

/** A drop this steep across the transition band is an encoder, not an instrument. */
export const BRICKWALL_DROP_DB = 35;

/** Width of the band either side of the edge used to measure how abruptly energy falls. */
export const EDGE_BAND_HZ = 750;

/** At or above this, nothing was discarded worth worrying about. */
export const LOSSLESS_CUTOFF_HZ = 20_500;

/** Below this a cutoff is far more likely to be the recording than an encoder. */
export const IMPLAUSIBLE_ENCODER_CUTOFF_HZ = 14_000;

/**
 * Hann window.
 *
 * A frame chopped out of a signal has discontinuous ends, and the FFT reads those steps as energy
 * spread across every bin — which would smear the very edge being measured. Tapering to zero at
 * both ends removes the step.
 */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  if (size <= 1) {
    if (size === 1) w[0] = 1;
    return w;
  }
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

/** In-place iterative radix-2 Cooley-Tukey. `size` must be a power of two. */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Frequency of a bin, in Hz. */
export function binToHz(bin: number, sampleRate: number, fftSize = SPECTRAL_FFT_SIZE): number {
  return (bin * sampleRate) / fftSize;
}

/**
 * Average magnitude spectrum in dB, across as many frames as the sample run allows.
 *
 * Averaging matters: a single frame landing on a quiet passage would read as a low cutoff and
 * accuse a clean file. Several frames spread through the audio describe the track.
 */
export function averageSpectrumDb(
  samples: Float64Array | number[],
  fftSize = SPECTRAL_FFT_SIZE,
): Float64Array {
  const bins = fftSize / 2;
  const out = new Float64Array(bins);
  const total = samples.length;
  if (total < fftSize) return out.fill(SPECTRAL_NOISE_FLOOR_DB);

  const window = hannWindow(fftSize);
  const hop = Math.max(1, Math.floor(fftSize / 2));
  const acc = new Float64Array(bins);
  let frames = 0;

  for (let start = 0; start + fftSize <= total; start += hop) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = Number(samples[start + i] ?? 0) * window[i]!;
    fftInPlace(re, im);
    for (let b = 0; b < bins; b++) {
      acc[b]! += Math.sqrt(re[b]! * re[b]! + im[b]! * im[b]!);
    }
    frames++;
  }

  if (frames === 0) return out.fill(SPECTRAL_NOISE_FLOOR_DB);
  let peak = 0;
  for (let b = 0; b < bins; b++) {
    acc[b]! /= frames;
    if (acc[b]! > peak) peak = acc[b]!;
  }
  if (peak <= 0) return out.fill(SPECTRAL_NOISE_FLOOR_DB);

  for (let b = 0; b < bins; b++) {
    const db = 20 * Math.log10(acc[b]! / peak);
    out[b] = Number.isFinite(db) ? Math.max(db, SPECTRAL_NOISE_FLOOR_DB) : SPECTRAL_NOISE_FLOOR_DB;
  }
  return out;
}

export interface SpectralProfile {
  /** Highest frequency still carrying real energy. */
  cutoffHz: number;
  /** How far energy falls across the band just above the cutoff — the edge's steepness. */
  edgeDropDb: number;
  /**
   * How much energy was already fading in the octave *below* the cutoff.
   *
   * The drop at the edge alone cannot separate an encoder from a recording, because a taper is
   * also near-silent by the time it ends — both fall away sharply at their last bin. What differs
   * is the approach: an encoder holds full energy right up to the wall and then stops, so this is
   * near zero, while a rolling-off recording is already fading long before it ends.
   */
  preEdgeDeclineDb: number;
  /** Nyquist for this file, so a cutoff can be read relative to what was possible. */
  nyquistHz: number;
}

/** Above this much fade before the edge, the decline is the recording's own. */
export const TAPER_DECLINE_DB = 9;

/**
 * Locate the top of the signal and measure how sharply it ends.
 *
 * The cutoff is the highest bin above the floor; the drop compares mean energy in the band below
 * that point against the band above it. A brickwall shows a large difference across a narrow span.
 */
export function analyseSpectrum(
  spectrumDb: Float64Array,
  sampleRate: number,
  fftSize = SPECTRAL_FFT_SIZE,
): SpectralProfile {
  const nyquistHz = sampleRate / 2;
  const bins = spectrumDb.length;
  const floor = SPECTRAL_NOISE_FLOOR_DB + 6;

  let cutoffBin = 0;
  for (let b = bins - 1; b >= 0; b--) {
    if (spectrumDb[b]! > floor) {
      cutoffBin = b;
      break;
    }
  }
  const cutoffHz = binToHz(cutoffBin, sampleRate, fftSize);

  const bandBins = Math.max(1, Math.round((EDGE_BAND_HZ * fftSize) / sampleRate));
  const mean = (from: number, to: number): number => {
    const lo = Math.max(0, from);
    const hi = Math.min(bins - 1, to);
    if (hi < lo) return SPECTRAL_NOISE_FLOOR_DB;
    let sum = 0;
    for (let b = lo; b <= hi; b++) sum += spectrumDb[b]!;
    return sum / (hi - lo + 1);
  };

  const below = mean(cutoffBin - bandBins, Math.max(0, cutoffBin - 1));
  const above = mean(cutoffBin + 1, cutoffBin + bandBins);

  // Energy well below the edge versus energy just below it: flat means a wall, falling means a fade.
  const far = mean(cutoffBin - bandBins * 5, cutoffBin - bandBins * 3);
  const near = mean(cutoffBin - bandBins * 2, Math.max(0, cutoffBin - 1));

  return { cutoffHz, edgeDropDb: below - above, preEdgeDeclineDb: far - near, nyquistHz };
}

export type TranscodeVerdict = 'lossless' | 'transcode-suspected' | 'inconclusive';

export interface TranscodeAssessment {
  verdict: TranscodeVerdict;
  cutoffHz: number;
  /** Bitrate the cutoff is characteristic of, when one is implied. Never presented as certain. */
  impliedSource?: string;
  /** Plain-language reason, so a badge can explain itself rather than just accuse. */
  reason: string;
}

/** Cutoffs characteristic of common encoders. Only consulted once an edge is judged artificial. */
function impliedSourceFor(cutoffHz: number): string | undefined {
  if (cutoffHz < 17_000) return '128 kbps';
  if (cutoffHz < 19_500) return '192 kbps';
  if (cutoffHz < LOSSLESS_CUTOFF_HZ) return '320 kbps';
  return undefined;
}

/**
 * Judge a profile.
 *
 * Order matters. Full-band energy clears the file outright. Otherwise a low cutoff only counts
 * against the file when the edge is *sharp*: a gradual slope is what a real recording does, and
 * that returns inconclusive rather than an accusation. A cutoff far below any encoder's is also
 * treated as the recording, not as evidence — no encoder throws away everything above 12 kHz.
 */
export function classifySpectralProfile(profile: SpectralProfile): TranscodeAssessment {
  const { cutoffHz, edgeDropDb, nyquistHz } = profile;

  if (cutoffHz >= Math.min(LOSSLESS_CUTOFF_HZ, nyquistHz - 500)) {
    return {
      verdict: 'lossless',
      cutoffHz,
      reason: 'Energy reaches the top of the spectrum.',
    };
  }

  if (cutoffHz < IMPLAUSIBLE_ENCODER_CUTOFF_HZ) {
    return {
      verdict: 'inconclusive',
      cutoffHz,
      reason: 'Cutoff sits below any encoder — most likely the recording itself.',
    };
  }

  if (edgeDropDb < BRICKWALL_DROP_DB || profile.preEdgeDeclineDb >= TAPER_DECLINE_DB) {
    return {
      verdict: 'inconclusive',
      cutoffHz,
      reason: 'High frequencies taper off gradually, which is a recording and not an encoder.',
    };
  }

  return {
    verdict: 'transcode-suspected',
    cutoffHz,
    impliedSource: impliedSourceFor(cutoffHz),
    reason: 'Energy stops abruptly, the signature of lossy encoding before the lossless wrapper.',
  };
}

/** Whole assessment from raw mono samples. */
export function assessSamplesForTranscode(
  samples: Float64Array | number[],
  sampleRate: number,
  fftSize = SPECTRAL_FFT_SIZE,
): TranscodeAssessment {
  const spectrum = averageSpectrumDb(samples, fftSize);
  return classifySpectralProfile(analyseSpectrum(spectrum, sampleRate, fftSize));
}

/* ------------------------------------------------------------------------ *
 * Clipping and loudness.
 *
 * Spectral analysis answers "was this lossy before it was lossless". These answer the two other
 * questions a listener would ask about a file they did not encode themselves: has it been driven
 * into distortion, and how loud is it really. All three describe the audio rather than its
 * container, which is the standard the fidelity badge is held to.
 * ------------------------------------------------------------------------ */

/** Samples this close to full scale are treated as pinned rather than merely loud. */
export const CLIP_THRESHOLD = 0.9921; // ≈ -0.07 dBFS

/** A single sample at full scale is a peak; several in a row is a flattened waveform. */
export const CLIP_RUN_SAMPLES = 3;

export interface ClippingReport {
  /** Samples sitting at or above the threshold. */
  clippedSamples: number;
  /** Share of the whole file, 0–1. A few thousandths is audible on transients. */
  clippedRatio: number;
  /** Longest unbroken run — the flat top of the wave, and the clearest sign of real damage. */
  longestRunSamples: number;
  /** True only when a run long enough to be distortion was found, not merely a loud peak. */
  clipped: boolean;
}

/**
 * Find flattened peaks.
 *
 * A lone sample at full scale is normal on a loud master. What matters is consecutive samples
 * pinned there, because that is a waveform whose top has been cut off and cannot be recovered.
 * Reported as a ratio as well as a count so a three-minute song and a nine-hour audiobook can be
 * compared honestly.
 */
export function detectClipping(
  samples: Float64Array | number[],
  threshold = CLIP_THRESHOLD,
  runSamples = CLIP_RUN_SAMPLES,
): ClippingReport {
  const total = samples.length;
  if (total === 0) {
    return { clippedSamples: 0, clippedRatio: 0, longestRunSamples: 0, clipped: false };
  }
  let clippedSamples = 0;
  let run = 0;
  let longestRun = 0;
  for (let i = 0; i < total; i++) {
    const value = Math.abs(Number(samples[i] ?? 0));
    if (value >= threshold) {
      clippedSamples++;
      run++;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }
  return {
    clippedSamples,
    clippedRatio: clippedSamples / total,
    longestRunSamples: longestRun,
    clipped: longestRun >= runSamples,
  };
}

/**
 * K-weighting, per ITU-R BS.1770.
 *
 * Two biquads: a high-frequency shelf approximating the acoustic effect of a head, then a
 * high-pass that discards rumble the ear barely registers. The published coefficients are
 * specified at 48 kHz and are applied here directly at whatever rate the file uses, which is the
 * usual practice — the error at 44.1 kHz is a few hundredths of a decibel, far below anything a
 * listener could notice and far below the difference this is used to describe.
 */
function kWeight(samples: Float64Array | number[]): Float64Array {
  const n = samples.length;
  const stage1 = new Float64Array(n);
  // Shelving filter.
  const b0 = 1.53512485958697;
  const b1 = -2.69169618940638;
  const b2 = 1.19839281085285;
  const a1 = -1.69065929318241;
  const a2 = 0.73248077421585;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = Number(samples[i] ?? 0);
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    stage1[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  // High-pass filter.
  const c0 = 1.0;
  const c1 = -2.0;
  const c2 = 1.0;
  const d1 = -1.99004745483398;
  const d2 = 0.99007225036621;
  const out = new Float64Array(n);
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = stage1[i]!;
    const y0 = c0 * x0 + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Absolute gate from BS.1770-4: anything below this is silence, not quiet content. */
const ABSOLUTE_GATE_LUFS = -70;

/** Relative gate: blocks more than this far below the ungated mean are excluded. */
const RELATIVE_GATE_LU = -10;

/**
 * Integrated loudness in LUFS, gated per BS.1770-4.
 *
 * Gating is what separates this from a plain average: without it a quiet audiobook with long
 * pauses reads far quieter than it sounds, because the silence is averaged in. Returns
 * -Infinity for a file with no content above the absolute gate, which is the honest answer for
 * silence rather than a very negative number that looks like a measurement.
 */
export function integratedLoudnessLufs(
  samples: Float64Array | number[],
  sampleRate: number,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) return -Infinity;
  const weighted = kWeight(samples);
  const blockSamples = Math.max(1, Math.round(sampleRate * 0.4));
  const hop = Math.max(1, Math.round(blockSamples * 0.25)); // 75% overlap, per the standard.

  const blockLoudness: number[] = [];
  const blockMeanSquare: number[] = [];
  for (let start = 0; start + blockSamples <= weighted.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + blockSamples; i++) sum += weighted[i]! * weighted[i]!;
    const meanSquare = sum / blockSamples;
    if (meanSquare <= 0) continue;
    blockMeanSquare.push(meanSquare);
    blockLoudness.push(-0.691 + 10 * Math.log10(meanSquare));
  }
  if (blockLoudness.length === 0) return -Infinity;

  const aboveAbsolute: number[] = [];
  for (let i = 0; i < blockLoudness.length; i++) {
    if (blockLoudness[i]! > ABSOLUTE_GATE_LUFS) aboveAbsolute.push(blockMeanSquare[i]!);
  }
  if (aboveAbsolute.length === 0) return -Infinity;

  const meanOf = (values: number[]): number =>
    values.reduce((sum, v) => sum + v, 0) / values.length;

  const ungated = -0.691 + 10 * Math.log10(meanOf(aboveAbsolute));
  const relativeGate = ungated + RELATIVE_GATE_LU;

  const retained: number[] = [];
  for (let i = 0; i < blockLoudness.length; i++) {
    if (blockLoudness[i]! > ABSOLUTE_GATE_LUFS && blockLoudness[i]! > relativeGate) {
      retained.push(blockMeanSquare[i]!);
    }
  }
  if (retained.length === 0) return ungated;
  return -0.691 + 10 * Math.log10(meanOf(retained));
}
