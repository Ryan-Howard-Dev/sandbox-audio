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
