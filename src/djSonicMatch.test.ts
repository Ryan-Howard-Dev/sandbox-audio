import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findHarmonicMatchTrackId,
  formatSonicDeckLabel,
  harmonicMatchLabel,
  readLockerTrackSonic,
} from './djSonicMatch';
import type { SonicFeatures } from './sonicFeatures';

const sonicByTrackId = new Map<string, Partial<SonicFeatures>>();

vi.mock('./sonicFeatures', () => ({
  getSonicFeaturesForTrack: (trackId: string) => {
    const partial = sonicByTrackId.get(trackId);
    if (!partial) return null;
    return {
      bpm: partial.bpm,
      energy: partial.energy ?? 0.5,
      camelot: partial.camelot,
      musicalKey: partial.musicalKey,
      source: partial.source ?? 'analyzed',
      analyzedAt: partial.analyzedAt ?? Date.now(),
    };
  },
}));

describe('djSonicMatch', () => {
  beforeEach(() => {
    sonicByTrackId.clear();
  });

  it('formats deck sonic label', () => {
    sonicByTrackId.set('a', { bpm: 128.2, camelot: '8A', musicalKey: 'Am' });
    expect(formatSonicDeckLabel(readLockerTrackSonic('a'))).toBe('128 BPM · 8A Am');
  });

  it('finds best harmonic match excluding source', () => {
    sonicByTrackId.set('src', { camelot: '8A' });
    sonicByTrackId.set('same', { camelot: '8A' });
    sonicByTrackId.set('far', { camelot: '3B' });
    const match = findHarmonicMatchTrackId('src', [{ id: 'src' }, { id: 'same' }, { id: 'far' }]);
    expect(match).toBe('same');
  });

  it('labels harmonic distance', () => {
    expect(harmonicMatchLabel('8A', '8A')).toBe('Same key');
    expect(harmonicMatchLabel('8A', '9A')).toBe('Compatible');
  });
});
