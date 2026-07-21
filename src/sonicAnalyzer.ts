/**
 * Lightweight Web Audio analysis — no external APIs or WASM.
 * BPM is heuristic (autocorrelation on energy envelope); treat as approximate.
 */

import { formatMusicalKey, parseMusicalKey, toCamelot } from './camelot';
import type { SonicFeatures } from './sonicFeatures';

const MAX_ANALYSIS_SECONDS = 45;
const ANALYSIS_HOP = 512;
const ANALYSIS_FRAME = 2048;

function monoMix(audio: AudioBuffer): Float32Array {
  const len = Math.min(
    audio.length,
    Math.floor(audio.sampleRate * MAX_ANALYSIS_SECONDS),
  );
  if (audio.numberOfChannels <= 1) {
    return audio.getChannelData(0).subarray(0, len);
  }
  const out = new Float32Array(len);
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      out[i] = (out[i] ?? 0) + (data[i] ?? 0) / audio.numberOfChannels;
    }
  }
  return out;
}

function computeRmsEnergy(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

function computeZeroCrossingRate(data: Float32Array): number {
  if (data.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1] ?? 0;
    const cur = data[i] ?? 0;
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
  }
  return Math.min(1, (crossings / data.length) * 12);
}

function computeSpectralCentroid(data: Float32Array, sampleRate: number): number {
  const n = 4096;
  if (data.length < n) return 0.5;
  const start = Math.floor((data.length - n) / 2);
  let magSum = 0;
  let weighted = 0;
  const nyquist = sampleRate / 2;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      const sample = data[start + t] ?? 0;
      re += sample * Math.cos(angle);
      im -= sample * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    const freq = (k * nyquist) / (n / 2);
    magSum += mag;
    weighted += freq * mag;
  }
  if (magSum <= 0) return 0.5;
  return Math.max(0, Math.min(1, weighted / magSum / nyquist));
}

function buildEnergyEnvelope(data: Float32Array): number[] {
  const env: number[] = [];
  for (let i = 0; i + ANALYSIS_FRAME < data.length; i += ANALYSIS_HOP) {
    let sum = 0;
    for (let j = 0; j < ANALYSIS_FRAME; j++) {
      const v = data[i + j] ?? 0;
      sum += v * v;
    }
    env.push(Math.sqrt(sum / ANALYSIS_FRAME));
  }
  return env;
}

/** Autocorrelation peak on energy envelope — approximate BPM only. */
function estimateBpm(data: Float32Array, sampleRate: number): number | undefined {
  const env = buildEnergyEnvelope(data);
  if (env.length < 48) return undefined;

  const minLag = Math.max(2, Math.floor((60 / 200) * (sampleRate / ANALYSIS_HOP)));
  const maxLag = Math.min(env.length - 1, Math.floor((60 / 55) * (sampleRate / ANALYSIS_HOP)));

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i + lag < env.length; i++) {
      corr += (env[i] ?? 0) * (env[i + lag] ?? 0);
      count++;
    }
    if (count <= 0) continue;
    corr /= count;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = (60 * sampleRate) / (bestLag * ANALYSIS_HOP);
  if (!Number.isFinite(bpm) || bpm < 50 || bpm > 220) return undefined;
  return Math.round(bpm);
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function computeChroma(data: Float32Array, sampleRate: number): number[] {
  const frame = 4096;
  const hop = 2048;
  const chroma = new Array<number>(12).fill(0);
  let frames = 0;
  for (let start = 0; start + frame < data.length; start += hop) {
    const spectrum = new Array<number>(frame / 2).fill(0);
    for (let k = 1; k < frame / 2; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < frame; t++) {
        const angle = (2 * Math.PI * k * t) / frame;
        const sample = data[start + t] ?? 0;
        re += sample * Math.cos(angle);
        im -= sample * Math.sin(angle);
      }
      spectrum[k] = Math.sqrt(re * re + im * im);
    }
    for (let k = 1; k < frame / 2; k++) {
      const freq = (k * sampleRate) / frame;
      if (freq < 60 || freq > 5000) continue;
      const pitch = Math.round(12 * Math.log2(freq / 440)) + 69;
      const pc = ((pitch % 12) + 12) % 12;
      chroma[pc] = (chroma[pc] ?? 0) + (spectrum[k] ?? 0);
    }
    frames++;
  }
  if (frames <= 0) return chroma;
  const max = Math.max(...chroma, 1e-9);
  return chroma.map((v) => v / max);
}

function correlateProfile(chroma: number[], profile: number[], root: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (chroma[i] ?? 0) * (profile[(i - root + 12) % 12] ?? 0);
  }
  return sum;
}

function estimateMusicalKey(data: Float32Array, sampleRate: number): { musicalKey: string; camelot: string } | null {
  const chroma = computeChroma(data, sampleRate);
  const total = chroma.reduce((a, b) => a + b, 0);
  if (total <= 0.01) return null;

  let bestRoot = 0;
  let bestMode: 'major' | 'minor' = 'major';
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    const majorScore = correlateProfile(chroma, MAJOR_PROFILE, root);
    const minorScore = correlateProfile(chroma, MINOR_PROFILE, root);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestRoot = root;
      bestMode = 'major';
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestRoot = root;
      bestMode = 'minor';
    }
  }
  if (bestScore <= 0) return null;
  const musicalKey = formatMusicalKey(bestRoot, bestMode);
  const camelot = toCamelot(parseMusicalKey(musicalKey));
  if (!camelot) return null;
  return { musicalKey, camelot };
}

export async function analyzeAudioBlob(blob: Blob): Promise<SonicFeatures | null> {
  if (typeof AudioContext === 'undefined' || blob.size <= 0) return null;
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = monoMix(audio);
    if (mono.length < ANALYSIS_FRAME * 4) return null;

    const keyGuess = estimateMusicalKey(mono, audio.sampleRate);

    return {
      bpm: estimateBpm(mono, audio.sampleRate),
      spectralCentroid: computeSpectralCentroid(mono, audio.sampleRate),
      zeroCrossingRate: computeZeroCrossingRate(mono),
      energy: computeRmsEnergy(mono),
      musicalKey: keyGuess?.musicalKey,
      camelot: keyGuess?.camelot,
      source: 'analyzed',
      analyzedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
