import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./prefsStorage', () => ({
  prefsGetItem: vi.fn(() => null),
  prefsSetItem: vi.fn(),
}));

import {
  isServerReachableCached,
  noteTier34Reachable,
  refreshTier34Reachability,
} from './tier34/client';

describe('Sandbox Server health cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    noteTier34Reachable(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches reachability for 30 seconds', () => {
    noteTier34Reachable(true);
    expect(isServerReachableCached()).toBe(true);
    vi.advanceTimersByTime(29_000);
    expect(isServerReachableCached()).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(isServerReachableCached()).toBe(false);
  });

  it('refreshTier34Reachability is exported for probes', () => {
    expect(typeof refreshTier34Reachability).toBe('function');
  });
});
