/**
 * Silence detection for podcast Smart Speed — analyze buffers and cache region maps.
 */

import { isAndroid } from './platformEnv';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export interface SilenceRegion {
  startSeconds: number;
  endSeconds: number;
}

const SILENCE_MAP_CACHE_KEY = 'sandbox_podcast_silence_maps_v1';
const MAX_CACHED_MAPS = 24;

/** RMS below this is treated as silence (roughly -34 dBFS on normalized float audio). */
export const PODCAST_SILENCE_RMS_THRESHOLD = 0.018;

/** Minimum contiguous silence length to compress or skip. */
export const PODCAST_MIN_SILENCE_MS = 380;

const ANALYSIS_WINDOW_SAMPLES = 2048;

export function measureAnalyserRms(analyser: AnalyserNode, scratch: Uint8Array): number {
  if (scratch.length < analyser.fftSize) {
    scratch = new Uint8Array(analyser.fftSize);
  }
  analyser.getByteTimeDomainData(scratch as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < scratch.length; i++) {
    const v = (scratch[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / scratch.length);
}

export function detectSilenceRegionsInChannel(
  samples: Float32Array,
  sampleRate: number,
  threshold = PODCAST_SILENCE_RMS_THRESHOLD,
  minSilenceMs = PODCAST_MIN_SILENCE_MS,
): SilenceRegion[] {
  if (!samples.length || sampleRate <= 0) return [];
  const window = Math.max(256, Math.floor((sampleRate * 30) / 1000));
  const windowMs = (window / sampleRate) * 1000;
  const minWindows = Math.max(1, Math.ceil(minSilenceMs / windowMs));
  const regions: SilenceRegion[] = [];
  let runStart: number | null = null;
  let quietRun = 0;

  const flush = (endSample: number) => {
    if (runStart == null || quietRun < minWindows) {
      runStart = null;
      quietRun = 0;
      return;
    }
    regions.push({
      startSeconds: runStart / sampleRate,
      endSeconds: endSample / sampleRate,
    });
    runStart = null;
    quietRun = 0;
  };

  for (let i = 0; i < samples.length; i += window) {
    const end = Math.min(samples.length, i + window);
    let sum = 0;
    for (let j = i; j < end; j++) {
      const v = samples[j] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    if (rms < threshold) {
      if (runStart == null) runStart = i;
      quietRun += 1;
    } else {
      flush(i);
    }
  }
  flush(samples.length);
  return mergeAdjacentRegions(regions, 0.12);
}

export function detectSilenceRegionsInBuffer(
  buffer: AudioBuffer,
  threshold = PODCAST_SILENCE_RMS_THRESHOLD,
  minSilenceMs = PODCAST_MIN_SILENCE_MS,
): SilenceRegion[] {
  const channels = buffer.numberOfChannels;
  if (channels <= 0) return [];
  const mixed = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) {
      mixed[i] = (mixed[i] ?? 0) + (ch[i] ?? 0) / channels;
    }
  }
  return detectSilenceRegionsInChannel(mixed, buffer.sampleRate, threshold, minSilenceMs);
}

function mergeAdjacentRegions(regions: SilenceRegion[], gapSeconds: number): SilenceRegion[] {
  if (!regions.length) return [];
  const sorted = [...regions].sort((a, b) => a.startSeconds - b.startSeconds);
  const out: SilenceRegion[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = sorted[i]!;
    if (cur.startSeconds - prev.endSeconds <= gapSeconds) {
      prev.endSeconds = Math.max(prev.endSeconds, cur.endSeconds);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function findSilenceRegionAt(
  regions: SilenceRegion[],
  timeSeconds: number,
): SilenceRegion | null {
  for (const region of regions) {
    if (timeSeconds >= region.startSeconds && timeSeconds < region.endSeconds - 0.04) {
      return region;
    }
  }
  return null;
}

type SilenceMapCache = Record<string, SilenceRegion[]>;

function readSilenceMapCache(): SilenceMapCache {
  const raw = prefsGetItem(SILENCE_MAP_CACHE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SilenceMapCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadCachedSilenceRegions(episodeId: string): SilenceRegion[] | null {
  const map = readSilenceMapCache()[episodeId];
  return Array.isArray(map) && map.length > 0 ? map : null;
}

export function saveCachedSilenceRegions(episodeId: string, regions: SilenceRegion[]): void {
  const cache = readSilenceMapCache();
  cache[episodeId] = regions;
  const keys = Object.keys(cache);
  while (keys.length > MAX_CACHED_MAPS) {
    const drop = keys.shift();
    if (drop) delete cache[drop];
  }
  prefsSetItem(SILENCE_MAP_CACHE_KEY, JSON.stringify(cache));
}

/** Max encoded bytes to fully decode for offline silence maps (PCM expands ~10×). */
const MAX_SILENCE_DECODE_BYTES = isAndroid() ? 4 * 1024 * 1024 : 48 * 1024 * 1024;

export async function analyzeSilenceRegionsFromBlob(
  blobUrl: string,
): Promise<SilenceRegion[]> {
  if (typeof AudioContext === 'undefined') return [];
  const res = await fetch(blobUrl);
  if (!res.ok) return [];
  const buf = await res.arrayBuffer();
  // Full decodeAudioData of podcast episodes OOM-crashes Android WebView, especially
  // while locker downloads are saving blobs in the same process.
  if (buf.byteLength <= 0 || buf.byteLength > MAX_SILENCE_DECODE_BYTES) return [];
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0));
    return detectSilenceRegionsInBuffer(audio);
  } catch {
    return [];
  } finally {
    void ctx.close();
  }
}

export async function ensureSilenceRegionsForEpisode(
  episodeId: string,
  audioUrl: string,
): Promise<SilenceRegion[]> {
  const cached = loadCachedSilenceRegions(episodeId);
  if (cached) return cached;
  if (!audioUrl.startsWith('blob:')) return [];
  const regions = await analyzeSilenceRegionsFromBlob(audioUrl);
  if (regions.length > 0) saveCachedSilenceRegions(episodeId, regions);
  return regions;
}
