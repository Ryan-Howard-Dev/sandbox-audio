import { describe, expect, it } from 'vitest';
import { resolvePlaybackEqBands, routeEqBands } from './sonicPeqPresets';
import { isHeadphoneSonicRoute } from './sandboxSpatial';

describe('sonicPeqPresets', () => {
  it('route-auto uses phone speaker compensation', () => {
    const bands = resolvePlaybackEqBands('phone-speaker', 'route-auto');
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0]?.type).toBe('lowshelf');
  });

  it('flat preset bypasses route EQ', () => {
    expect(resolvePlaybackEqBands('phone-speaker', 'flat')).toEqual([]);
  });

  it('bass-boost preset replaces route auto', () => {
    const bands = resolvePlaybackEqBands('phone-speaker', 'bass-boost');
    expect(bands).toHaveLength(2);
    expect(routeEqBands('phone-speaker').length).toBeGreaterThan(2);
  });
});

describe('sandboxSpatial', () => {
  it('detects headphone routes', () => {
    expect(isHeadphoneSonicRoute('wired-headphones')).toBe(true);
    expect(isHeadphoneSonicRoute('bluetooth')).toBe(true);
    expect(isHeadphoneSonicRoute('phone-speaker')).toBe(false);
  });
});
