import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTransportSnapshot,
  resetTransport,
  resetTransportForTests,
  subscribeTransport,
  updateTransport,
} from './transportStore';

afterEach(() => resetTransportForTests());

describe('transportStore', () => {
  it('starts idle and music-shaped', () => {
    const s = getTransportSnapshot();
    expect(s.pillar).toBe('music');
    expect(s.isPlaying).toBe(false);
    expect(s.controls.shuffle).toBe(true);
  });

  it('derives controls from the pillar rather than trusting a caller', () => {
    updateTransport({ pillar: 'audiobook' });
    const s = getTransportSnapshot();
    expect(s.controls.shuffle).toBe(false);
    expect(s.controls.queue).toBe(false);
  });

  it('notifies subscribers when something changes', () => {
    const seen = vi.fn();
    subscribeTransport(seen);
    updateTransport({ positionMs: 1000 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  /*
   * The property the whole store exists for: a poll that reports the same numbers must not wake
   * the tree. Without this, position polling repaints the artwork several times a second.
   */
  it('stays silent when an update changes nothing', () => {
    updateTransport({ title: 'Bloom', positionMs: 1000 });
    const seen = vi.fn();
    subscribeTransport(seen);
    updateTransport({ title: 'Bloom', positionMs: 1000 });
    updateTransport({});
    expect(seen).not.toHaveBeenCalled();
  });

  it('compares structural position by value, not identity', () => {
    updateTransport({ structural: { label: 'Page 1 of 10', percent: 10 } });
    const seen = vi.fn();
    subscribeTransport(seen);
    // A freshly built object with the same contents is not a change.
    updateTransport({ structural: { label: 'Page 1 of 10', percent: 10 } });
    expect(seen).not.toHaveBeenCalled();
    updateTransport({ structural: { label: 'Page 2 of 10', percent: 20 } });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps a snapshot immutable, so a subscriber cannot be handed a mutated object', () => {
    const before = getTransportSnapshot();
    updateTransport({ title: 'Bloom' });
    const after = getTransportSnapshot();
    expect(before).not.toBe(after);
    expect(before.title).toBe('');
  });

  it('distinguishes unknown length from not loaded', () => {
    updateTransport({ pillar: 'spoken-text', durationMs: -1 });
    expect(getTransportSnapshot().durationMs).toBe(-1);
    expect(getTransportSnapshot().controls.seekBar).toBe(false);
  });

  it('unsubscribes cleanly', () => {
    const seen = vi.fn();
    const off = subscribeTransport(seen);
    off();
    updateTransport({ positionMs: 5 });
    expect(seen).not.toHaveBeenCalled();
  });

  it('resets to idle and says so once', () => {
    updateTransport({ title: 'Bloom', isPlaying: true });
    const seen = vi.fn();
    subscribeTransport(seen);
    resetTransport();
    expect(getTransportSnapshot().title).toBe('');
    expect(seen).toHaveBeenCalledTimes(1);
    resetTransport();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
