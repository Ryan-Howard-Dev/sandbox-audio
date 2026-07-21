import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDiscoveryMixContinuation,
  discoveryMixRadioSession,
  prepareDiscoveryMixQueue,
} from './discoveryMixRadio';
import { discoveryMixRadioSession as sessionFromPlayer } from './playerMixRadio';
import type { DiscoveryMix } from './discoveryMixes';
import { resolveDiscoveryMixFromCacheSync } from './discoveryMixes';

const sampleMix: DiscoveryMix = {
  id: 'daily-discovery',
  kind: 'daily-discovery',
  title: 'Daily Discovery',
  subtitle: 'Test',
  generatedAt: Date.now(),
  tracks: [
    {
      envelopeId: 'a',
      title: 'A',
      artist: 'One',
      url: 'https://example.com/a.mp3',
      durationSeconds: 180,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'a',
    },
    {
      envelopeId: 'b',
      title: 'B',
      artist: 'Two',
      url: 'https://example.com/b.mp3',
      durationSeconds: 200,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'b',
    },
  ],
};

describe('discoveryMixRadio', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates discovery-mfy session from mix', () => {
    const session = discoveryMixRadioSession(sampleMix);
    expect(session.kind).toBe('discovery-mfy');
    expect(session.discoveryMixId).toBe('daily-discovery');
    expect(session.discoveryMixKind).toBe('daily-discovery');
    expect(session.seedTitle).toBe('Daily Discovery');
    expect(sessionFromPlayer(sampleMix)).toEqual(session);
  });

  it('prepares queue preserving track set via playerMixRadio ordering', () => {
    const ordered = prepareDiscoveryMixQueue(sampleMix);
    expect(ordered.length).toBe(2);
    expect(new Set(ordered.map((t) => t.envelopeId))).toEqual(new Set(['a', 'b']));
  });

  it('resolveDiscoveryMixFromCacheSync returns null without cache', () => {
    expect(resolveDiscoveryMixFromCacheSync('daily-discovery', 'daily-discovery')).toBeNull();
  });

  it('buildDiscoveryMixContinuation falls back for non-mfy sessions', () => {
    const seed = sampleMix.tracks[0]!;
    const out = buildDiscoveryMixContinuation(
      { kind: 'radio', seedTitle: 'X', seedArtist: 'Y' },
      seed,
      new Set(),
      2,
    );
    expect(Array.isArray(out)).toBe(true);
  });
});
