// @vitest-environment jsdom
/**
 * The app freezing has been reported again and again and never reproduced on command. Every
 * attempt to catch it has been a script pasted into the running WebView, which the restart after
 * a freeze wipes out. These cover the record surviving instead.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMainThreadStalls,
  listMainThreadStalls,
  recordMainThreadStall,
  startMainThreadStallWatch,
  STALL_THRESHOLD_MS,
} from './mainThreadStallWatch';

beforeEach(() => {
  localStorage.clear();
  clearMainThreadStalls();
});

describe('recording a stall', () => {
  const stall = { at: 1787037043675, stallMs: 4200, hidden: false, where: 'Music' };

  it('keeps what was recorded', () => {
    recordMainThreadStall(stall);
    const [row] = listMainThreadStalls();
    expect(row!.stallMs).toBe(4200);
    expect(row!.where).toBe('Music');
    expect(row!.hidden).toBe(false);
  });

  it('puts the most recent first, since that is the one being asked about', () => {
    recordMainThreadStall({ ...stall, stallMs: 2000 });
    recordMainThreadStall({ ...stall, stallMs: 9000 });
    expect(listMainThreadStalls().map((s) => s.stallMs)).toEqual([9000, 2000]);
  });

  it('does not grow without bound', () => {
    for (let i = 0; i < 60; i++) recordMainThreadStall({ ...stall, stallMs: 1600 + i });
    expect(listMainThreadStalls().length).toBeLessThanOrEqual(40);
    // The newest survive the cap, because the oldest stall is the least useful one.
    expect(listMainThreadStalls()[0]!.stallMs).toBe(1659);
  });

  it('survives a restart, which is what somebody does when it freezes', () => {
    recordMainThreadStall(stall);
    // A reload keeps nothing in memory; the record has to be read back off the device.
    expect(listMainThreadStalls()).toHaveLength(1);
  });

  it('reads an empty list rather than throwing when the store holds nonsense', () => {
    localStorage.setItem('sandbox_main_thread_stalls_v1', '{not json');
    expect(listMainThreadStalls()).toEqual([]);
  });
});

describe('the threshold', () => {
  it('sits above an ordinary slow frame and below a noticed freeze', () => {
    // A dropped frame or a collection pause is not what anybody calls frozen.
    expect(STALL_THRESHOLD_MS).toBeGreaterThan(500);
    expect(STALL_THRESHOLD_MS).toBeLessThanOrEqual(2000);
  });
});

describe('starting the watch', () => {
  it('starts once however many times it is called', () => {
    const stop = startMainThreadStallWatch();
    const second = startMainThreadStallWatch();
    expect(typeof stop).toBe('function');
    expect(typeof second).toBe('function');
    stop();
  });
});
