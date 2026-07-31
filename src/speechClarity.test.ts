import { describe, expect, it } from 'vitest';
import { AUDIOBOOK_ENVELOPE_PREFIX } from './audiobookPlayback';
import {
  AUDIOBOOK_CLARITY,
  PODCAST_CLARITY,
  dbToLinear,
  highPassHzForRoute,
  makeupFraction,
  speechClarityProfileFor,
  theoreticalGainReductionDb,
} from './speechClarity';

describe('speech clarity profiles', () => {
  it('compresses audiobooks harder than podcasts', () => {
    // The whole reason two profiles exist: performed narration swings further than conversation.
    expect(AUDIOBOOK_CLARITY.thresholdDb).toBeLessThan(PODCAST_CLARITY.thresholdDb);
    expect(AUDIOBOOK_CLARITY.ratio).toBeGreaterThan(PODCAST_CLARITY.ratio);
  });

  it('keeps the podcast tuning exactly as it shipped', () => {
    // Audiobook support must not quietly change how existing podcasts sound.
    expect(PODCAST_CLARITY).toMatchObject({
      highPassHz: 85,
      presenceHz: 2800,
      presenceGainDb: 3.2,
      presenceQ: 1.1,
      thresholdDb: -22,
      kneeDb: 8,
      ratio: 2.2,
      attackSec: 0.006,
      releaseSec: 0.14,
    });
  });

  it('uses a soft knee and a release long enough not to pump between words', () => {
    expect(AUDIOBOOK_CLARITY.kneeDb).toBeGreaterThanOrEqual(10);
    expect(AUDIOBOOK_CLARITY.releaseSec).toBeGreaterThanOrEqual(0.2);
    // Fast enough to catch a plosive before it gets through.
    expect(AUDIOBOOK_CLARITY.attackSec).toBeLessThanOrEqual(0.006);
  });

  it('leaves a low male fundamental alone', () => {
    // A male voice bottoms out near 85 Hz; cutting above that hollows out the narrator.
    expect(AUDIOBOOK_CLARITY.highPassHz).toBeLessThanOrEqual(100);
  });

  describe('theoreticalGainReductionDb', () => {
    it('computes what full makeup would have to restore', () => {
      // -(-24) * (1 - 1/3) = 16 dB.
      expect(theoreticalGainReductionDb(AUDIOBOOK_CLARITY)).toBeCloseTo(16, 6);
      // -(-22) * (1 - 1/2.2) = 12 dB.
      expect(theoreticalGainReductionDb(PODCAST_CLARITY)).toBeCloseTo(12, 6);
    });

    it('is zero at unity ratio', () => {
      expect(theoreticalGainReductionDb({ ...AUDIOBOOK_CLARITY, ratio: 1 })).toBe(0);
    });
  });

  describe('makeup gain', () => {
    it('gives back only a fraction, so audiobooks do not dwarf every other station', () => {
      // Restoring all 16 dB would leave narration far louder than music and eat the ear-safety
      // headroom; a quarter lifts whispers without moving the perceived level.
      expect(makeupFraction(AUDIOBOOK_CLARITY)).toBeGreaterThan(0);
      expect(makeupFraction(AUDIOBOOK_CLARITY)).toBeLessThan(0.35);
      expect(makeupFraction(PODCAST_CLARITY)).toBeLessThan(0.35);
    });

    it('stays well short of the point where a full-scale peak would clip', () => {
      for (const profile of [AUDIOBOOK_CLARITY, PODCAST_CLARITY]) {
        expect(profile.makeupGainDb).toBeLessThan(theoreticalGainReductionDb(profile));
      }
    });
  });

  describe('dbToLinear', () => {
    it('converts the way the Web Audio gain param expects', () => {
      expect(dbToLinear(0)).toBeCloseTo(1, 10);
      expect(dbToLinear(6)).toBeCloseTo(1.9953, 3);
      expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
    });
  });

  describe('highPassHzForRoute', () => {
    it('lifts the corner to 200 Hz on a phone speaker', () => {
      // The driver cannot reproduce below that and only distorts trying; cutting frees headroom
      // for the band that carries the words.
      expect(highPassHzForRoute(AUDIOBOOK_CLARITY, 'phone-speaker')).toBe(200);
    });

    it('leaves real low-end outputs alone', () => {
      // The same cut through headphones would audibly thin a male narrator.
      for (const route of ['wired-headphones', 'bluetooth', 'line-out', 'pc-speaker'] as const) {
        expect(highPassHzForRoute(AUDIOBOOK_CLARITY, route)).toBe(AUDIOBOOK_CLARITY.highPassHz);
      }
    });

    it('falls back to the profile when the route is unknown', () => {
      expect(highPassHzForRoute(AUDIOBOOK_CLARITY, null)).toBe(AUDIOBOOK_CLARITY.highPassHz);
      expect(highPassHzForRoute(AUDIOBOOK_CLARITY, undefined)).toBe(AUDIOBOOK_CLARITY.highPassHz);
    });

    it('never lowers a profile corner that already sits above 200 Hz', () => {
      expect(highPassHzForRoute({ ...AUDIOBOOK_CLARITY, highPassHz: 260 }, 'phone-speaker')).toBe(
        260,
      );
    });
  });

  describe('speechClarityProfileFor', () => {
    it('routes audiobooks and podcasts to their own tunings', () => {
      expect(speechClarityProfileFor('audiobook:12345')).toBe(AUDIOBOOK_CLARITY);
      expect(speechClarityProfileFor('podcast:feed-x:ep-y')).toBe(PODCAST_CLARITY);
    });

    it('leaves music untouched', () => {
      // Compressing music would flatten exactly the dynamics a listener came for.
      expect(speechClarityProfileFor('local-abc123')).toBeNull();
      expect(speechClarityProfileFor('music:track-1')).toBeNull();
    });

    it('handles missing and blank ids', () => {
      expect(speechClarityProfileFor(null)).toBeNull();
      expect(speechClarityProfileFor(undefined)).toBeNull();
      expect(speechClarityProfileFor('   ')).toBeNull();
    });

    it('does not match a prefix appearing later in the id', () => {
      expect(speechClarityProfileFor('local-my-audiobook:1')).toBeNull();
    });

    it('stays in step with the audiobook envelope prefix it cannot import', () => {
      // speechClarity holds the prefix as a literal to avoid an import cycle through the playback
      // router. Nothing but this assertion stops the two from drifting apart.
      expect(speechClarityProfileFor(`${AUDIOBOOK_ENVELOPE_PREFIX}1`)).toBe(AUDIOBOOK_CLARITY);
    });
  });
});
