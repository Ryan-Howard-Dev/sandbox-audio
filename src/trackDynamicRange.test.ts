import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DR_MEASUREMENT_VERSION,
  MAX_MEASURABLE_SECONDS,
  canMeasureDynamicRange,
  clearDynamicRangeStoreForTests,
  dynamicRangeUnavailableReason,
  forgetDynamicRange,
  loadDynamicRange,
  measureTrackDynamicRange,
  saveDynamicRange,
  type DecodeAudio,
} from './trackDynamicRange';
import type { MediaEnvelope } from './sandboxLayer1';

function envelope(over: Partial<MediaEnvelope> = {}): MediaEnvelope {
  return {
    envelopeId: 'local-1',
    title: 'A Track',
    artist: 'Someone',
    url: 'file:///music/track.flac',
    durationSeconds: 240,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: 'src-1',
    mimeType: 'audio/flac',
    ...over,
  } as MediaEnvelope;
}

const RATE = 1_000;
const BLOCK = RATE * 3;

/** A quiet sine with a full-scale transient in each block — DR 20 by construction. */
function dynamicPcm(blocks: number): Float32Array {
  const out = new Float32Array(BLOCK * blocks);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.1 * Math.sin((2 * Math.PI * 50 * i) / RATE);
  for (let b = 0; b < blocks; b += 1) out[b * BLOCK + 10] = 1;
  return out;
}

function decoderFor(pcm: Float32Array, channels = 1): DecodeAudio {
  return async () => ({
    numberOfChannels: channels,
    sampleRate: RATE,
    getChannelData: () => pcm,
  });
}

beforeEach(() => {
  clearDynamicRangeStoreForTests();
});

describe('canMeasureDynamicRange', () => {
  it('measures a lossless track of ordinary length', () => {
    expect(canMeasureDynamicRange(envelope())).toBe(true);
  });

  it('declines a lossy file, which is not the question the badge is asking', () => {
    // The number exists to tell a careful master from a crushed one among files that already
    // claim to be the good version.
    expect(canMeasureDynamicRange(envelope({ mimeType: 'audio/mpeg', url: 'x.mp3' }))).toBe(false);
    expect(dynamicRangeUnavailableReason(envelope({ mimeType: 'audio/mpeg', url: 'x.mp3' }))).toBe(
      'lossy',
    );
  });

  it('declines a track too short to measure', () => {
    expect(canMeasureDynamicRange(envelope({ durationSeconds: 4 }))).toBe(false);
    expect(dynamicRangeUnavailableReason(envelope({ durationSeconds: 4 }))).toBe('too-short');
  });

  it('declines a track too long to decode into memory', () => {
    /*
     * Twelve minutes of stereo is already about a quarter of a gigabyte once decoded. An
     * audiobook would be tens of gigabytes and has nothing to say through this measure anyway.
     */
    const long = envelope({ durationSeconds: MAX_MEASURABLE_SECONDS + 1 });
    expect(canMeasureDynamicRange(long)).toBe(false);
    expect(dynamicRangeUnavailableReason(long)).toBe('too-long');
  });

  it('declines when nothing is playing', () => {
    expect(canMeasureDynamicRange(null)).toBe(false);
    expect(dynamicRangeUnavailableReason(undefined)).toBe('no-track');
  });

  it('has no reason to give when the track is measurable', () => {
    expect(dynamicRangeUnavailableReason(envelope())).toBeNull();
  });
});

describe('the store', () => {
  const record = {
    dr: 12,
    verdict: 'moderate' as const,
    peakDb: -0.3,
    measuredAt: 1_700_000_000_000,
    version: DR_MEASUREMENT_VERSION,
  };

  it('remembers a reading so a track is never decoded twice', () => {
    saveDynamicRange('local-1', record);
    expect(loadDynamicRange('local-1')).toEqual(record);
  });

  it('has nothing for a track nobody measured', () => {
    expect(loadDynamicRange('local-9')).toBeNull();
  });

  it('discards a reading from older arithmetic rather than showing it', () => {
    /*
     * A stored reading is a claim about audio, and one produced by different arithmetic is a
     * different claim. A badge disagreeing with itself between two tracks is worse than a badge
     * that is missing.
     */
    saveDynamicRange('local-1', { ...record, version: DR_MEASUREMENT_VERSION - 1 });
    expect(loadDynamicRange('local-1')).toBeNull();
  });

  it('forgets on request', () => {
    saveDynamicRange('local-1', record);
    forgetDynamicRange('local-1');
    expect(loadDynamicRange('local-1')).toBeNull();
  });

  it('ignores an empty id rather than storing one', () => {
    saveDynamicRange('', record);
    expect(loadDynamicRange('')).toBeNull();
  });
});

describe('measureTrackDynamicRange', () => {
  it('decodes and measures', async () => {
    const result = await measureTrackDynamicRange(new ArrayBuffer(8), decoderFor(dynamicPcm(10)));
    expect(result!.dr).toBe(20);
    expect(result!.verdict).toBe('wide');
    expect(result!.version).toBe(DR_MEASUREMENT_VERSION);
  });

  it('feeds the analyser in slices rather than holding the track twice', async () => {
    // A long buffer exercises the slicing loop; the answer must not depend on it.
    const result = await measureTrackDynamicRange(new ArrayBuffer(8), decoderFor(dynamicPcm(40)));
    expect(result!.dr).toBe(20);
  });

  it('says nothing when the file will not decode', async () => {
    const broken: DecodeAudio = async () => {
      throw new Error('unsupported');
    };
    expect(await measureTrackDynamicRange(new ArrayBuffer(8), broken)).toBeNull();
  });

  it('says nothing for silence rather than reporting a number', async () => {
    const silent = decoderFor(new Float32Array(BLOCK * 10));
    expect(await measureTrackDynamicRange(new ArrayBuffer(8), silent)).toBeNull();
  });

  it('says nothing for a decode with no channels', async () => {
    const empty: DecodeAudio = async () => ({
      numberOfChannels: 0,
      sampleRate: RATE,
      getChannelData: () => new Float32Array(0),
    });
    expect(await measureTrackDynamicRange(new ArrayBuffer(8), empty)).toBeNull();
  });

  it('stamps when it was measured', async () => {
    const at = 1_700_000_000_000;
    const result = await measureTrackDynamicRange(
      new ArrayBuffer(8),
      decoderFor(dynamicPcm(10)),
      at,
    );
    expect(result!.measuredAt).toBe(at);
  });

  it('asks the decoder for the bytes exactly once', async () => {
    const decode = vi.fn(decoderFor(dynamicPcm(10)));
    await measureTrackDynamicRange(new ArrayBuffer(8), decode);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
