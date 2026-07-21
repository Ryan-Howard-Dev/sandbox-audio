import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  isTier34ReachableCached: vi.fn(() => false),
}));

vi.mock('./platformEnv', () => ({
  isCapacitorNative: vi.fn(() => false),
  isTauri: vi.fn(() => true),
}));

import { getTier34BaseUrl, isTier34ReachableCached } from './tier34/client';
import { canResolveFullStreams } from './catalogDirect';
import { proxiedArtworkUrl } from './displaySanitize';

describe('canResolveFullStreams', () => {
  beforeEach(() => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    vi.mocked(isTier34ReachableCached).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when no backend URL is configured', () => {
    expect(canResolveFullStreams()).toBe(false);
  });

  it('returns false when URL is set but health cache is not OK', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://127.0.0.1:3001');
    vi.mocked(isTier34ReachableCached).mockReturnValue(false);
    expect(canResolveFullStreams()).toBe(false);
  });

  it('returns true only when URL is set and health probe succeeded', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://127.0.0.1:3001');
    vi.mocked(isTier34ReachableCached).mockReturnValue(true);
    expect(canResolveFullStreams()).toBe(true);
  });
});

describe('proxiedArtworkUrl on desktop', () => {
  it('upgrades insecure TheAudioDB art to https for Tauri mixed-content', () => {
    const url = 'http://www.theaudiodb.com/images/media/artist/thumb/abc.jpg';
    expect(proxiedArtworkUrl(url)).toBe(url.replace('http://', 'https://'));
  });

  it('does not wrap session blob URLs (keeps error recovery working)', () => {
    const blob = 'blob:http://localhost/abc-123';
    expect(proxiedArtworkUrl(blob)).toBe(blob);
  });
});
