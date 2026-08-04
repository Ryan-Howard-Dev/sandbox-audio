/**
 * Measuring a track's dynamic range, and remembering the answer.
 *
 * dynamicRange.ts does the arithmetic. This decides when it is worth doing at all, which is most
 * of the engineering, because decoding is the expensive part and the badge redraws constantly.
 *
 * The cost is not subtle. decodeAudioData hands back the whole track as float PCM: five minutes
 * of stereo at 44.1 kHz is about a hundred megabytes resident, and there is no way to ask a
 * compressed file for the middle three minutes without decoding what comes before it. So this
 * never measures on its own. A listener asks, once, for a track they are curious about; the
 * reading is written down and the question is never asked again.
 *
 * That is also why it is gated to lossless. The whole point of the number is to tell a careful
 * master from a crushed one *within* the files that already claim to be the good version — a
 * 128 kbps MP3's dynamic range is not the interesting thing about it.
 */
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  createDynamicRangeAnalyser,
  dynamicRangeVerdict,
  hasEnoughAudioForDynamicRange,
  type DynamicRangeVerdict,
} from './dynamicRange';
import { isLosslessEnvelope } from './trackFidelityLabel';
import type { MediaEnvelope } from './sandboxLayer1';

const STORE_KEY = 'sandbox_track_dynamic_range';
/**
 * Bumped whenever the measurement changes.
 *
 * A stored reading is a claim about audio, and a claim produced by different arithmetic is a
 * different claim. Old rows are dropped rather than shown next to new ones, because a badge
 * disagreeing with itself between two tracks is worse than a badge that is missing.
 */
export const DR_MEASUREMENT_VERSION = 1;

/** Enough readings to cover a listening habit; the store is a convenience, not an archive. */
const MAX_ROWS = 2_000;

/**
 * The longest track worth decoding.
 *
 * Twelve minutes of stereo is roughly a quarter of a gigabyte once decoded, which is already more
 * than a phone should be asked for. Past that the answer is not worth the allocation, and an
 * audiobook or a DJ set has nothing useful to say through this measure anyway.
 */
export const MAX_MEASURABLE_SECONDS = 12 * 60;

export interface DynamicRangeRecord {
  dr: number;
  verdict: DynamicRangeVerdict;
  /** Loudest sample in dBFS — a master pinned at 0.0 is its own tell. */
  peakDb: number;
  measuredAt: number;
  version: number;
}

type Store = Record<string, DynamicRangeRecord>;

function readStore(): Store {
  try {
    const raw = prefsGetItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    const keys = Object.keys(store);
    if (keys.length > MAX_ROWS) {
      // Oldest readings go first. A track measured long ago is one the listener has stopped
      // asking about.
      const trimmed: Store = {};
      for (const key of keys
        .sort((a, b) => (store[b]!.measuredAt ?? 0) - (store[a]!.measuredAt ?? 0))
        .slice(0, MAX_ROWS)) {
        trimmed[key] = store[key]!;
      }
      prefsSetItem(STORE_KEY, JSON.stringify(trimmed));
      return;
    }
    prefsSetItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* a lost reading is a re-measure, never an error worth surfacing */
  }
}

/** A stored reading, or null when there is none this version can trust. */
export function loadDynamicRange(trackId: string): DynamicRangeRecord | null {
  const id = trackId?.trim();
  if (!id) return null;
  const row = readStore()[id];
  if (!row || row.version !== DR_MEASUREMENT_VERSION) return null;
  return row;
}

export function saveDynamicRange(trackId: string, record: DynamicRangeRecord): void {
  const id = trackId?.trim();
  if (!id) return;
  const store = readStore();
  store[id] = record;
  writeStore(store);
}

export function forgetDynamicRange(trackId: string): void {
  const id = trackId?.trim();
  if (!id) return;
  const store = readStore();
  if (!(id in store)) return;
  delete store[id];
  writeStore(store);
}

/**
 * Whether this track can be measured at all.
 *
 * Three reasons to decline, all of them about the track rather than the moment: it is not
 * lossless, so the number would not answer the question the badge is for; it is too short for the
 * measurement to mean anything; or it is long enough that decoding it would cost more memory than
 * the answer is worth.
 */
export function canMeasureDynamicRange(envelope: MediaEnvelope | null | undefined): boolean {
  if (!envelope) return false;
  if (!isLosslessEnvelope(envelope)) return false;
  const seconds = envelope.durationSeconds ?? 0;
  if (!hasEnoughAudioForDynamicRange(seconds)) return false;
  return seconds <= MAX_MEASURABLE_SECONDS;
}

/** Why a track cannot be measured, for a control that would otherwise be a dead button. */
export function dynamicRangeUnavailableReason(
  envelope: MediaEnvelope | null | undefined,
): 'no-track' | 'lossy' | 'too-short' | 'too-long' | null {
  if (!envelope) return 'no-track';
  if (!isLosslessEnvelope(envelope)) return 'lossy';
  const seconds = envelope.durationSeconds ?? 0;
  if (!hasEnoughAudioForDynamicRange(seconds)) return 'too-short';
  if (seconds > MAX_MEASURABLE_SECONDS) return 'too-long';
  return null;
}

/** Injected so the measurement can be tested without a browser audio stack. */
export interface DecodeAudio {
  (bytes: ArrayBuffer): Promise<{
    numberOfChannels: number;
    sampleRate: number;
    getChannelData(channel: number): Float32Array;
  }>;
}

/**
 * The platform decoder.
 *
 * OfflineAudioContext rather than AudioContext: it needs no output device, no user gesture, and
 * nothing to close afterwards. Its own rate is set to the file's where the caller knows it, since
 * decodeAudioData resamples to the context and resampling down would shave the transient peaks
 * this measurement is entirely about.
 */
export function browserDecodeAudio(sampleRateHint?: number): DecodeAudio | null {
  const Ctor =
    typeof globalThis !== 'undefined'
      ? ((globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
        (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext)
      : undefined;
  if (!Ctor) return null;
  const rate =
    Number.isFinite(sampleRateHint) && (sampleRateHint ?? 0) >= 8_000 ? sampleRateHint! : 44_100;
  return async (bytes) => {
    const ctx = new Ctor(1, 1, rate);
    return ctx.decodeAudioData(bytes);
  };
}

/** How much audio to hand the analyser at a time. Keeps one slice live, not one track. */
const SLICE_SAMPLES = 65_536;

/**
 * Decode a track and measure it.
 *
 * Returns null when the audio cannot be decoded or has nothing measurable in it — a corrupt file
 * and a silent one both being cases where saying nothing beats saying a number.
 */
export async function measureTrackDynamicRange(
  bytes: ArrayBuffer,
  decode: DecodeAudio,
  now: number = Date.now(),
): Promise<DynamicRangeRecord | null> {
  let buffer: Awaited<ReturnType<DecodeAudio>>;
  try {
    buffer = await decode(bytes);
  } catch {
    return null;
  }

  const channelCount = Math.max(0, buffer.numberOfChannels);
  if (channelCount === 0) return null;

  const analyser = createDynamicRangeAnalyser(channelCount, buffer.sampleRate);
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c += 1) channels.push(buffer.getChannelData(c));

  const length = channels[0]?.length ?? 0;
  for (let offset = 0; offset < length; offset += SLICE_SAMPLES) {
    const end = Math.min(offset + SLICE_SAMPLES, length);
    analyser.push(channels.map((data) => data.subarray(offset, end)));
  }

  const result = analyser.finish();
  if (!result) return null;
  return {
    dr: result.dr,
    verdict: dynamicRangeVerdict(result.dr),
    peakDb: result.peakDb,
    measuredAt: now,
    version: DR_MEASUREMENT_VERSION,
  };
}

/**
 * The bytes of a locker track, for measuring.
 *
 * Only the locker. A measurement is a claim about a specific file, and a stream re-fetched from a
 * provider is not guaranteed to be the same encode as the one that played — a reading taken from
 * one and shown against the other would be a quiet lie. Owned files are the ones this can be
 * honest about, and they are also the ones somebody cares enough about to ask.
 *
 * Imported lazily so measuring a track is what pulls the storage layer in, rather than opening the
 * player.
 */
export async function loadLockerTrackBytes(
  envelope: MediaEnvelope,
): Promise<ArrayBuffer | null> {
  if (envelope.provider !== 'local-vault') return null;
  const id = (envelope.sourceId || envelope.envelopeId).trim().replace(/^local-/, '');
  if (!id) return null;
  try {
    const { getLockerAudioBlob } = await import('./lockerStorage');
    const blob = await getLockerAudioBlob(id);
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

/** Test seam — the store is prefs-backed and would otherwise carry between tests. */
export function clearDynamicRangeStoreForTests(): void {
  try {
    prefsSetItem(STORE_KEY, '{}');
  } catch {
    /* nothing to clear */
  }
}
