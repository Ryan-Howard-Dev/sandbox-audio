import { describe, expect, it } from 'vitest';
import {
  detectClipping,
  integratedLoudnessLufs,
  analyseSpectrum,
  assessSamplesForTranscode,
  averageSpectrumDb,
  binToHz,
  classifySpectralProfile,
  hannWindow,
  SPECTRAL_FFT_SIZE,
} from './spectralTranscode';

const SAMPLE_RATE = 44_100;
const DURATION_SAMPLES = SPECTRAL_FFT_SIZE * 8;

/**
 * Build a signal from sinusoids up to `cutoffHz`.
 *
 * `rolloffHz` of 0 gives a brickwall — nothing at all above the cutoff, which is what an encoder
 * leaves. A non-zero value fades the partials out over that span, which is what a real recording
 * or an analogue source does. Distinguishing those two is the whole job.
 */
function synth(cutoffHz: number, rolloffHz = 0): Float64Array {
  const out = new Float64Array(DURATION_SAMPLES);
  const step = 100;
  for (let f = step; f < SAMPLE_RATE / 2; f += step) {
    let amp: number;
    if (f <= cutoffHz) {
      amp = 1;
    } else if (rolloffHz > 0 && f < cutoffHz + rolloffHz) {
      amp = 1 - (f - cutoffHz) / rolloffHz;
    } else {
      continue;
    }
    if (amp <= 0) continue;
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    // Fixed phase offset per partial so the sum does not spike into a single impulse.
    const phase = (f % 17) * 0.37;
    for (let i = 0; i < DURATION_SAMPLES; i++) out[i]! += amp * Math.sin(w * i + phase);
  }
  let peak = 0;
  for (let i = 0; i < DURATION_SAMPLES; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) for (let i = 0; i < DURATION_SAMPLES; i++) out[i]! /= peak;
  return out;
}

describe('hannWindow', () => {
  it('tapers to zero at both ends and peaks in the middle', () => {
    const w = hannWindow(8);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[7]).toBeCloseTo(0, 6);
    expect(w[4]!).toBeGreaterThan(0.8);
  });

  it('handles degenerate sizes without producing NaN', () => {
    expect(Array.from(hannWindow(0))).toEqual([]);
    expect(Array.from(hannWindow(1))).toEqual([1]);
  });
});

describe('averageSpectrumDb', () => {
  it('places a pure tone in the bin matching its frequency', () => {
    const samples = new Float64Array(DURATION_SAMPLES);
    const freq = 5_000;
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
    const spectrum = averageSpectrumDb(samples);
    let peakBin = 0;
    for (let b = 1; b < spectrum.length; b++) if (spectrum[b]! > spectrum[peakBin]!) peakBin = b;

    expect(binToHz(peakBin, SAMPLE_RATE)).toBeCloseTo(freq, -2);
  });

  it('returns a floor rather than NaN for silence or a short run', () => {
    const silence = averageSpectrumDb(new Float64Array(DURATION_SAMPLES));
    expect(silence.every((v) => Number.isFinite(v))).toBe(true);
    const tooShort = averageSpectrumDb(new Float64Array(16));
    expect(tooShort.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('analyseSpectrum', () => {
  it('finds the cutoff of a band-limited signal', () => {
    const profile = analyseSpectrum(averageSpectrumDb(synth(16_000)), SAMPLE_RATE);
    expect(profile.cutoffHz).toBeGreaterThan(15_000);
    expect(profile.cutoffHz).toBeLessThan(17_500);
  });

  it('reports a steeper edge for a brickwall than for a taper', () => {
    const wall = analyseSpectrum(averageSpectrumDb(synth(16_000)), SAMPLE_RATE);
    const taper = analyseSpectrum(averageSpectrumDb(synth(16_000, 4_000)), SAMPLE_RATE);
    expect(wall.edgeDropDb).toBeGreaterThan(taper.edgeDropDb);
  });
});

describe('transcode classification', () => {
  it('passes a full-band file as lossless', () => {
    const verdict = assessSamplesForTranscode(synth(21_500), SAMPLE_RATE);
    expect(verdict.verdict).toBe('lossless');
  });

  it('flags a hard cut at 16 kHz and names the implied source', () => {
    const verdict = assessSamplesForTranscode(synth(16_000), SAMPLE_RATE);
    expect(verdict.verdict).toBe('transcode-suspected');
    expect(verdict.impliedSource).toBe('128 kbps');
  });

  it('flags a hard cut at 19 kHz as the higher-rate encoder it resembles', () => {
    const verdict = assessSamplesForTranscode(synth(19_000), SAMPLE_RATE);
    expect(verdict.verdict).toBe('transcode-suspected');
    expect(verdict.impliedSource).toBe('192 kbps');
  });

  /*
   * The case that matters most. A vinyl rip or an old recording genuinely holds nothing up high,
   * and calling it a fake accuses a listener's legitimate file. Only the shape of the edge may
   * convict — a slope is never enough.
   */
  it('does not accuse a recording that simply rolls off', () => {
    // Full to 15 kHz, fading to nothing by 18 kHz: an analogue source, not an encoder.
    const verdict = assessSamplesForTranscode(synth(15_000, 3_000), SAMPLE_RATE);
    expect(verdict.verdict).toBe('inconclusive');
    expect(verdict.impliedSource).toBeUndefined();
  });

  it('treats a cutoff below any encoder as the recording, not evidence', () => {
    const verdict = classifySpectralProfile({
      cutoffHz: 11_000,
      edgeDropDb: 80,
      preEdgeDeclineDb: 0,
      nyquistHz: 22_050,
    });
    expect(verdict.verdict).toBe('inconclusive');
  });

  it('explains itself in every verdict, so a badge can say why', () => {
    for (const samples of [synth(21_500), synth(16_000), synth(15_000, 3_000)]) {
      expect(assessSamplesForTranscode(samples, SAMPLE_RATE).reason.length).toBeGreaterThan(20);
    }
  });
});

/*
 * Clipping and loudness answer the other two questions about a file you did not encode yourself:
 * has it been driven into distortion, and how loud is it actually. Both describe the audio rather
 * than its container, which is the standard the fidelity badge is held to.
 */
describe('detectClipping', () => {
  const clean = (): Float64Array => {
    const out = new Float64Array(SAMPLE_RATE);
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    return out;
  };

  it('passes audio with headroom', () => {
    const report = detectClipping(clean());
    expect(report.clipped).toBe(false);
    expect(report.clippedSamples).toBe(0);
  });

  it('flags a flattened run and reports how long it was', () => {
    const samples = clean();
    for (let i = 1000; i < 1040; i++) samples[i] = 1;
    const report = detectClipping(samples);
    expect(report.clipped).toBe(true);
    expect(report.longestRunSamples).toBeGreaterThanOrEqual(40);
    expect(report.clippedRatio).toBeGreaterThan(0);
  });

  /* One sample touching full scale is a peak on a loud master, not damage. */
  it('does not call an isolated peak clipping', () => {
    const samples = clean();
    samples[500] = 1;
    expect(detectClipping(samples).clipped).toBe(false);
  });

  it('handles an empty run without dividing by zero', () => {
    expect(detectClipping([]).clippedRatio).toBe(0);
  });
});

describe('integratedLoudnessLufs', () => {
  const sine = (amplitude: number, seconds = 3): Float64Array => {
    const out = new Float64Array(SAMPLE_RATE * seconds);
    for (let i = 0; i < out.length; i++) {
      out[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
    }
    return out;
  };

  /*
   * A full-scale sine has mean square 0.5, so an unweighted reading would be
   * -0.691 + 10*log10(0.5) ≈ -3.7 LUFS. K-weighting is not flat at 1 kHz — the shelf contributes
   * a little under a decibel there — which lands the real figure near -2.8, close to the -3.01
   * the standard is usually quoted as giving. Anchoring on the measured value keeps this test
   * honest about what K-weighting does rather than asserting the arithmetic without it.
   */
  it('measures a full-scale 1 kHz sine just under -3 LUFS', () => {
    expect(integratedLoudnessLufs(sine(1), SAMPLE_RATE)).toBeCloseTo(-2.8, 0);
  });

  it('drops by about 20 LU when the signal drops by 20 dB', () => {
    const loud = integratedLoudnessLufs(sine(1), SAMPLE_RATE);
    const quiet = integratedLoudnessLufs(sine(0.1), SAMPLE_RATE);
    expect(loud - quiet).toBeCloseTo(20, 0);
  });

  /* Silence is not a very negative number, it is the absence of a measurement. */
  it('returns -Infinity for silence rather than a misleading figure', () => {
    expect(integratedLoudnessLufs(new Float64Array(SAMPLE_RATE * 2), SAMPLE_RATE)).toBe(-Infinity);
    expect(integratedLoudnessLufs([], SAMPLE_RATE)).toBe(-Infinity);
    expect(integratedLoudnessLufs(sine(1), 0)).toBe(-Infinity);
  });

  /*
   * Gating is the whole point: without it, long pauses drag an audiobook's reading far below what
   * it sounds like. Speech with silence between phrases must measure close to the speech alone.
   */
  it('gates out silence so pauses do not deflate the reading', () => {
    const speech = sine(0.5, 2);
    const withPauses = new Float64Array(speech.length * 2);
    withPauses.set(speech, 0); // second half left silent
    const continuous = integratedLoudnessLufs(speech, SAMPLE_RATE);
    const gapped = integratedLoudnessLufs(withPauses, SAMPLE_RATE);
    expect(Math.abs(continuous - gapped)).toBeLessThan(1);
  });
});
