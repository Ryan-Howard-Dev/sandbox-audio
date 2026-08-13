/**
 * Bounding the legacy session mirror by bytes, not by rows.
 *
 * These rows are a mirror: since v3 the play log lives in IndexedDB, append-only and uncapped, and
 * these exist for the smart-playlist and analytics paths that still read them. They had grown to
 * 921KB on a real phone, in a store that had stopped accepting writes.
 *
 * The cap was a count, and a count cannot express what a row costs. Measured at 991 bytes each,
 * the 2000-row limit still allowed nearly two megabytes.
 */

import { describe, expect, it } from 'vitest';
import { capSessionsToBudget } from './playHistory';
import type { PlaySession } from './playHistory';

const session = (n: number, pad = 0): PlaySession =>
  ({
    id: `s${n}`,
    envelopeId: `env-${n}`,
    trackId: `t${n}`,
    title: `Track ${n}${'x'.repeat(pad)}`,
    artist: 'Artist',
    album: 'Album',
    playedAt: n,
    listenedSeconds: 120,
    trackDurationSeconds: 200,
  }) as PlaySession;

const bytesOf = (json: string) => json.length * 2;

describe('capSessionsToBudget', () => {
  it('keeps everything when it fits', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => session(i));
    const { kept } = capSessionsToBudget(sessions);
    expect(kept).toHaveLength(50);
  });

  it('holds the budget on rows the size real ones are', () => {
    // The case a row count cannot express. Real rows measured 991 bytes; these are comparable.
    const fat = Array.from({ length: 3000 }, (_, i) => session(i, 400));
    const { json, kept } = capSessionsToBudget(fat);
    expect(bytesOf(json)).toBeLessThanOrEqual(400 * 1024);
    expect(kept.length).toBeGreaterThan(200);
  });

  it('lets the floor win over the budget when rows are absurd', () => {
    /*
     * The two limits can disagree, and when they do the floor takes it: two hundred rows of two
     * kilobytes cannot fit in four hundred kilobytes, and the answer to that is not an empty
     * history. Stated here so the trade-off is a decision rather than a surprise.
     */
    const huge = Array.from({ length: 600 }, (_, i) => session(i, 2000));
    const { kept, json } = capSessionsToBudget(huge);
    expect(kept).toHaveLength(200);
    expect(bytesOf(json)).toBeGreaterThan(400 * 1024);
  });

  it('keeps the newest and drops the oldest', () => {
    const sessions = Array.from({ length: 3000 }, (_, i) => session(i, 400));
    const { kept } = capSessionsToBudget(sessions);
    expect(kept[0].id).toBe('s0');
    expect(kept.length).toBeLessThan(3000);
  });

  it('never trims the history away entirely', () => {
    // Absurdly large rows must still leave something behind rather than an empty list.
    const huge = Array.from({ length: 500 }, (_, i) => session(i, 20_000));
    const { kept } = capSessionsToBudget(huge);
    expect(kept.length).toBeGreaterThanOrEqual(200);
  });

  it('still respects the row ceiling for small rows', () => {
    const many = Array.from({ length: 5000 }, (_, i) => session(i));
    const { kept } = capSessionsToBudget(many);
    expect(kept.length).toBeLessThanOrEqual(2000);
  });

  it('produces json that parses back to what it kept', () => {
    const sessions = Array.from({ length: 800 }, (_, i) => session(i, 300));
    const { kept, json } = capSessionsToBudget(sessions);
    expect(JSON.parse(json)).toHaveLength(kept.length);
  });
});
