import { describe, expect, it } from 'vitest';
import { averageBitrateKbps } from './lockerStorage';

/*
 * Every locker import was stamped `bitrate: 320` regardless of the file, so a 96 kbps podcast rip
 * and a FLAC were recorded identically. The now-playing badge could not honestly show that, which
 * is why it showed the transport instead and read "MOBILE" where a listener looks for quality.
 * A number derived from the file is worth showing; a placeholder is not.
 */
describe('averageBitrateKbps', () => {
  it('derives kbps from bytes and duration', () => {
    // 5 MB over 210s ≈ 190 kbps.
    expect(averageBitrateKbps(5 * 1024 * 1024, 210)).toBe(200);
  });

  it('reports a lossless file as the high rate it is', () => {
    // ~30 MB over 180s — CD-rate FLAC territory.
    expect(averageBitrateKbps(31_000_000, 180)).toBeGreaterThan(1_000);
  });

  it('distinguishes a low-rate rip from a high-rate one', () => {
    const low = averageBitrateKbps(2_400_000, 200)!;
    const high = averageBitrateKbps(8_000_000, 200)!;
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
  });

  /* Unknown must stay unknown — the badge shows nothing rather than a fabricated number. */
  it('returns undefined when either input is unusable', () => {
    expect(averageBitrateKbps(0, 210)).toBeUndefined();
    expect(averageBitrateKbps(5_000_000, 0)).toBeUndefined();
    expect(averageBitrateKbps(undefined, undefined)).toBeUndefined();
    expect(averageBitrateKbps(Number.NaN, 210)).toBeUndefined();
    expect(averageBitrateKbps(-1, 210)).toBeUndefined();
  });
});
