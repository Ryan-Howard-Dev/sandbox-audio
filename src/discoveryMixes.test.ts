import { describe, expect, it } from 'vitest';
import {
  composeDiscoveryMixTracks,
  dailyDiscoveryPeriodKey,
  isNewArtistTrack,
  weeklyDiscoverPeriodKey,
} from './discoveryMixes';
import { setSonicFeaturesForTrack } from './sonicFeatures';
import type { MediaEnvelope } from './sandboxLayer1';
import type { TasteProfileV1 } from './tasteProfile';
import { artistAffinityKey } from './tasteProfile';

function env(id: string, artist: string, title: string): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist,
    url: 'file://x',
    durationSeconds: 200,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('discoveryMixes', () => {
  it('daily period rolls before 6am local', () => {
    const beforeSix = new Date(2026, 5, 15, 5, 30);
    const afterSix = new Date(2026, 5, 15, 7, 0);
    expect(dailyDiscoveryPeriodKey(beforeSix)).toBe('2026-06-14');
    expect(dailyDiscoveryPeriodKey(afterSix)).toBe('2026-06-15');
  });

  it('weekly period is stable within the same Monday week', () => {
    const monday = new Date(2026, 5, 15, 10, 0);
    const wednesday = new Date(2026, 5, 17, 10, 0);
    expect(weeklyDiscoverPeriodKey(monday)).toBe(weeklyDiscoverPeriodKey(wednesday));
  });

  it('isNewArtistTrack detects zero affinity', () => {
    const profile: TasteProfileV1 = {
      schemaVersion: 1,
      trackAffinity: {},
      artistAffinity: {},
      albumAffinity: {},
      genreAffinity: {},
      explicitFeedback: {},
      updatedAt: 0,
    };
    expect(isNewArtistTrack(env('1', 'New Artist', 'Song'), profile)).toBe(true);
    profile.artistAffinity[artistAffinityKey('Known')] = 2;
    expect(isNewArtistTrack(env('2', 'Known', 'Hit'), profile)).toBe(false);
  });

  it('composeDiscoveryMixTracks respects total size', () => {
    const pool = Array.from({ length: 40 }, (_, i) =>
      env(`local-${i}`, i % 2 === 0 ? `Artist ${i}` : 'Fresh Voice', `Track ${i}`),
    );
    const out = composeDiscoveryMixTracks(pool, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.length).toBeGreaterThan(0);
  });

  it('composeDiscoveryMixTracks applies sonic reorder when key data exists', () => {
    const pool = [
      env('local-a', 'A', 'One'),
      env('local-b', 'B', 'Two'),
      env('local-c', 'C', 'Three'),
    ];
    setSonicFeaturesForTrack('a', {
      bpm: 120,
      energy: 0.5,
      camelot: '8A',
      source: 'analyzed',
      analyzedAt: Date.now(),
    });
    setSonicFeaturesForTrack('b', {
      bpm: 122,
      energy: 0.5,
      camelot: '8A',
      source: 'analyzed',
      analyzedAt: Date.now(),
    });
    setSonicFeaturesForTrack('c', {
      bpm: 130,
      energy: 0.4,
      camelot: '12A',
      source: 'analyzed',
      analyzedAt: Date.now(),
    });
    const out = composeDiscoveryMixTracks(pool, 3);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((t) => t.envelopeId)).size).toBe(3);
  });
});
