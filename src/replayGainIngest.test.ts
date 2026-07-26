import { describe, expect, it } from 'vitest';
import {
  GAIN_LIMIT_DB,
  PEAK_CEILING_DBFS,
  TARGET_RMS_DBFS,
  measureLoudness,
  parseReplayGainPeakDbfs,
  parseReplayGainTagDb,
  trackGainFromLoudness,
} from './replayGainIngest';

describe('parseReplayGainTagDb', () => {
  it('parses the shapes taggers actually write', () => {
    expect(parseReplayGainTagDb('-7.25 dB')).toBe(-7.25);
    expect(parseReplayGainTagDb('+3.10 dB')).toBe(3.1);
    expect(parseReplayGainTagDb('-7.25dB')).toBe(-7.25);
    expect(parseReplayGainTagDb('  -6 DB ')).toBe(-6);
    expect(parseReplayGainTagDb('0.00 dB')).toBe(0);
  });

  it('rejects junk rather than guessing', () => {
    expect(parseReplayGainTagDb(undefined)).toBeNull();
    expect(parseReplayGainTagDb('')).toBeNull();
    expect(parseReplayGainTagDb('loud')).toBeNull();
    expect(parseReplayGainTagDb('-7.25 dB extra')).toBeNull();
  });

  it('rejects values too extreme to be a real master', () => {
    expect(parseReplayGainTagDb('-99 dB')).toBeNull();
    expect(parseReplayGainTagDb('120 dB')).toBeNull();
  });
});

describe('parseReplayGainPeakDbfs', () => {
  it('converts linear peak to dBFS', () => {
    expect(parseReplayGainPeakDbfs('1.0')).toBe(0);
    expect(parseReplayGainPeakDbfs('0.5')).toBe(-6);
  });

  it('rejects non-positive and unparseable peaks', () => {
    expect(parseReplayGainPeakDbfs('0')).toBeNull();
    expect(parseReplayGainPeakDbfs('-1')).toBeNull();
    expect(parseReplayGainPeakDbfs('abc')).toBeNull();
  });
});

describe('trackGainFromLoudness', () => {
  it('attenuates a track louder than target', () => {
    // A modern master at -8 dBFS RMS needs 6 dB off, and has room for it.
    expect(trackGainFromLoudness({ rmsDbfs: -8, peakDbfs: -0.5 })).toBe(-6);
  });

  it('boosts a track quieter than target when peak allows', () => {
    expect(trackGainFromLoudness({ rmsDbfs: -20, peakDbfs: -12 })).toBe(6);
  });

  it('is the identity at target', () => {
    expect(trackGainFromLoudness({ rmsDbfs: TARGET_RMS_DBFS, peakDbfs: -3 })).toBe(0);
  });

  it('never boosts past the peak ceiling', () => {
    // Quiet RMS but a full-scale transient: boosting would clip, so back off instead.
    const gain = trackGainFromLoudness({ rmsDbfs: -24, peakDbfs: 0 });
    expect(gain).toBe(PEAK_CEILING_DBFS);
    expect(0 + (gain ?? 0)).toBeLessThanOrEqual(PEAK_CEILING_DBFS);
  });

  it('clamps absurd corrections', () => {
    expect(trackGainFromLoudness({ rmsDbfs: -60, peakDbfs: -40 })).toBe(GAIN_LIMIT_DB);
    expect(trackGainFromLoudness({ rmsDbfs: 20, peakDbfs: 0 })).toBe(-GAIN_LIMIT_DB);
  });

  it('rejects an unmeasurable track', () => {
    expect(trackGainFromLoudness({ rmsDbfs: Number.NaN, peakDbfs: -3 })).toBeNull();
  });

  /**
   * The regression this module exists for: the old ingest stored peak dBFS and played it back as
   * gain, so quieter tracks were attenuated harder. Assert the ordering is now the right way up.
   */
  it('orders quiet above loud, which peak-as-gain did backwards', () => {
    const quiet = trackGainFromLoudness({ rmsDbfs: -22, peakDbfs: -6 }) ?? 0;
    const loud = trackGainFromLoudness({ rmsDbfs: -8, peakDbfs: -0.5 }) ?? 0;
    expect(quiet).toBeGreaterThan(loud);
  });
});

describe('measureLoudness', () => {
  it('measures full-scale DC as 0 dBFS on both counts', () => {
    expect(measureLoudness([new Float32Array([1, 1, 1, 1])])).toEqual({
      rmsDbfs: 0,
      peakDbfs: 0,
    });
  });

  it('separates peak from RMS', () => {
    // One full-scale sample in 100: peak 0 dBFS, RMS well below it.
    const data = new Float32Array(100);
    data[0] = 1;
    const measured = measureLoudness([data]);
    expect(measured?.peakDbfs).toBe(0);
    expect(measured?.rmsDbfs).toBeLessThan(-15);
  });

  it('averages across channels', () => {
    const left = new Float32Array([0.5, 0.5]);
    const right = new Float32Array([0.5, 0.5]);
    expect(measureLoudness([left, right])?.rmsDbfs).toBeCloseTo(-6, 1);
  });

  it('returns null for silence', () => {
    expect(measureLoudness([new Float32Array([0, 0, 0])])).toBeNull();
    expect(measureLoudness([])).toBeNull();
  });
});
