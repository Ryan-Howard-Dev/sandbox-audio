import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefsRemoveItem, prefsSetItem } from './prefsStorage';

vi.mock('./networkPlayPolicy', () => ({
  isWifiNetwork: vi.fn(() => true),
  isCellularNetwork: vi.fn(() => false),
}));

describe('loadAggressiveOfflineCacheEnabled smart default', () => {
  afterEach(() => {
    prefsRemoveItem('sandbox_aggressive_offline_cache');
    vi.resetModules();
  });

  it('defaults to on when unset and on Wi‑Fi', async () => {
    const { loadAggressiveOfflineCacheEnabled } = await import('./sandboxSettings');
    expect(loadAggressiveOfflineCacheEnabled()).toBe(true);
  });

  it('respects explicit false even on Wi‑Fi', async () => {
    prefsSetItem('sandbox_aggressive_offline_cache', 'false');
    const { loadAggressiveOfflineCacheEnabled } = await import('./sandboxSettings');
    expect(loadAggressiveOfflineCacheEnabled()).toBe(false);
  });

  it('respects explicit true', async () => {
    prefsSetItem('sandbox_aggressive_offline_cache', 'true');
    const { loadAggressiveOfflineCacheEnabled } = await import('./sandboxSettings');
    expect(loadAggressiveOfflineCacheEnabled()).toBe(true);
  });
});
