/**
 * ReplayGain derivation at ingest time (pure; IO lives in lockerStorage).
 *
 * The previous ingest stored *peak dBFS* in a field named `replayGainDb`, and playback fed that
 * straight into `replayGainMultiplier` as a gain. Peak is not loudness, and the sign is not a
 * coincidence: peak dBFS is always <= 0, so every value was an attenuation, and the quieter the
 * track the harder it was attenuated. That is loudness normalization running backwards.
 *
 * It was invisible while D-1 (the pinned IndexedDB version) made every lookup return null.
 * Fixing D-1 is what made it audible, so it ships fixed in the same branch.
 */

/** Loudness target. RMS proxy for EBU R128 -14 LUFS: no K-weighting, no gating. */
export const TARGET_RMS_DBFS = -14;

/** Ceiling for peak after gain. Below 0 dBFS so intersample peaks don't clip the DAC. */
export const PEAK_CEILING_DBFS = -1;

/** Bound on applied gain. Beyond this the estimate is more likely wrong than the track quiet. */
export const GAIN_LIMIT_DB = 12;

export interface LoudnessMeasurement {
  /** RMS of the analyzed region in dBFS. */
  rmsDbfs: number;
  /** Highest absolute sample in the analyzed region, in dBFS. */
  peakDbfs: number;
}

/**
 * ReplayGain tags are written as a signed decibel value: `-7.25 dB`, `+3.10 dB`, sometimes bare.
 * Anything outside +/-60 dB is a broken tag rather than an unusual master, and applying it would
 * be far worse than ignoring it.
 */
export function parseReplayGainTagDb(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*(?:dB)?\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || Math.abs(value) > 60) return null;
  return value;
}

/** Peak tags are linear (1.0 == full scale), not decibels. */
export function parseReplayGainPeakDbfs(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const linear = Number(String(raw).trim());
  if (!Number.isFinite(linear) || linear <= 0) return null;
  return Math.round(20 * Math.log10(linear) * 10) / 10;
}

/**
 * Gain that moves the measured loudness to the target, then backed off far enough that the
 * loudest sample stays under the ceiling.
 *
 * The peak limit only ever reduces gain, so a wide-dynamic-range track that already peaks near
 * full scale gets no boost instead of a clipped one. That is the standard "prevent clipping"
 * behaviour, and silence beats distortion.
 */
export function trackGainFromLoudness(measurement: LoudnessMeasurement): number | null {
  const { rmsDbfs, peakDbfs } = measurement;
  if (!Number.isFinite(rmsDbfs)) return null;
  let gain = TARGET_RMS_DBFS - rmsDbfs;
  gain = Math.max(-GAIN_LIMIT_DB, Math.min(GAIN_LIMIT_DB, gain));
  if (Number.isFinite(peakDbfs)) {
    gain = Math.min(gain, PEAK_CEILING_DBFS - peakDbfs);
  }
  return Math.round(gain * 10) / 10;
}

/**
 * Whether a just-resolved track warrants background loudness analysis.
 *
 * A resolved gain of exactly 0 means "nothing stored", which is every locker row imported before
 * ingest measured loudness correctly. Only locker tracks qualify: remote sources have no row to
 * write back to, and re-analysing them on every play would be pure waste.
 */
export function shouldBackfillLockerTrackGain(env: {
  replayGainDb: number;
  provider?: string;
  sourceId?: string;
}): boolean {
  return env.replayGainDb === 0 && env.provider === 'local-vault' && !!env.sourceId?.trim();
}

/** Sum-of-squares and peak in one pass; callers hold the decoded buffer. */
export function measureLoudness(channels: ArrayLike<number>[]): LoudnessMeasurement | null {
  let sumSquares = 0;
  let count = 0;
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0;
      sumSquares += v * v;
      const abs = v < 0 ? -v : v;
      if (abs > peak) peak = abs;
    }
    count += data.length;
  }
  if (count === 0) return null;
  const rms = Math.sqrt(sumSquares / count);
  if (rms <= 0 || peak <= 0) return null;
  return {
    rmsDbfs: Math.round(20 * Math.log10(rms) * 10) / 10,
    peakDbfs: Math.round(20 * Math.log10(peak) * 10) / 10,
  };
}
