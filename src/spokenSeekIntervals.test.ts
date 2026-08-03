import { describe, expect, it } from 'vitest';
import { backIntervalFor, seekIntervalsFor, seekTargetSeconds } from './spokenSeekIntervals';

describe('backIntervalFor', () => {
  it('is shorter than the forward jump, because it is a different request', () => {
    expect(backIntervalFor(30)).toBeLessThan(30);
  });

  it('lands on the interval the book players settled on', () => {
    expect(backIntervalFor(30)).toBe(15);
    expect(backIntervalFor(15)).toBe(10);
  });

  it('never drops below the length of a lost moment', () => {
    // Under ten seconds does not clear the distraction that caused the press.
    expect(backIntervalFor(10)).toBe(10);
    expect(backIntervalFor(2)).toBe(10);
  });

  it('never grows into re-listening, however long the forward jump is', () => {
    expect(backIntervalFor(60)).toBe(20);
    expect(backIntervalFor(600)).toBe(20);
  });

  it('falls back to the default rather than returning nonsense', () => {
    expect(backIntervalFor(Number.NaN)).toBe(15);
    expect(backIntervalFor(0)).toBe(15);
    expect(backIntervalFor(-30)).toBe(15);
  });
});

describe('seekIntervalsFor', () => {
  it('keeps the configured number as the forward jump', () => {
    expect(seekIntervalsFor('podcast', 45).forward).toBe(45);
    expect(seekIntervalsFor('audiobook', 15).forward).toBe(15);
  });

  it('gives spoken audio an asymmetric pair', () => {
    for (const pillar of ['podcast', 'audiobook', 'spoken-text'] as const) {
      const { back, forward } = seekIntervalsFor(pillar, 30);
      expect(back).toBe(15);
      expect(forward).toBe(30);
    }
  });

  it('leaves music symmetric, since its buttons change track anyway', () => {
    expect(seekIntervalsFor('music', 30)).toEqual({ back: 30, forward: 30 });
  });

  it('defaults a missing setting to thirty forward', () => {
    expect(seekIntervalsFor('audiobook', Number.NaN)).toEqual({ back: 15, forward: 30 });
  });
});

describe('seekTargetSeconds', () => {
  it('moves by the delta', () => {
    expect(seekTargetSeconds({ currentSeconds: 100, deltaSeconds: 30, durationSeconds: 600 })).toBe(
      130,
    );
    expect(
      seekTargetSeconds({ currentSeconds: 100, deltaSeconds: -15, durationSeconds: 600 }),
    ).toBe(85);
  });

  it('stops at the beginning rather than going negative', () => {
    expect(seekTargetSeconds({ currentSeconds: 4, deltaSeconds: -15, durationSeconds: 600 })).toBe(
      0,
    );
  });

  it('parks at the last second rather than ending the item', () => {
    expect(seekTargetSeconds({ currentSeconds: 590, deltaSeconds: 30, durationSeconds: 600 })).toBe(
      600,
    );
  });

  it('applies only the floor when the length is not known yet', () => {
    expect(seekTargetSeconds({ currentSeconds: 590, deltaSeconds: 30, durationSeconds: 0 })).toBe(
      620,
    );
  });

  it('survives a position the decoder has not reported yet', () => {
    expect(
      seekTargetSeconds({ currentSeconds: Number.NaN, deltaSeconds: 30, durationSeconds: 600 }),
    ).toBe(30);
  });
});
