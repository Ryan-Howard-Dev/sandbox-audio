import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./securitySettings', () => {
  const store: Record<string, string> = {};
  return {
    loadSecret: (k: string) => store[k] ?? '',
    saveSecret: (k: string, v: string) => {
      store[k] = v;
    },
    secretStorage: () => localStorage,
  };
});
vi.mock('./airGapMode', () => ({ isAirGapEnabled: () => false }));
vi.mock('./fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
  isJsonLikeContentType: (ct: string) => /json/i.test(ct),
}));

import { fetchWithTimeout } from './fetchWithTimeout';
import {
  isPodcastIndexAvailable,
  loadPodcastIndexCredentials,
  podcastIndexAuthHeaders,
  savePodcastIndexCredentials,
  searchPodcastIndexShows,
  testPodcastIndexCredentials,
} from './podcastIndexProvider';

const mockFetch = vi.mocked(fetchWithTimeout);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  savePodcastIndexCredentials({ key: '', secret: '' });
});

describe('podcast index credentials', () => {
  it('is unavailable until both key and secret are set', () => {
    expect(isPodcastIndexAvailable()).toBe(false);
    savePodcastIndexCredentials({ key: 'abc' });
    expect(isPodcastIndexAvailable()).toBe(false);
    savePodcastIndexCredentials({ secret: 'def' });
    expect(isPodcastIndexAvailable()).toBe(true);
  });

  it('trims stored credentials', () => {
    savePodcastIndexCredentials({ key: '  k  ', secret: '  s  ' });
    expect(loadPodcastIndexCredentials()).toEqual({ key: 'k', secret: 's' });
  });
});

describe('podcastIndexAuthHeaders', () => {
  it('sends key, matching timestamp and a sha1 hex digest', async () => {
    const headers = await podcastIndexAuthHeaders(
      { key: 'KEY', secret: 'SECRET' },
      1_700_000_000_000,
    );
    expect(headers['X-Auth-Key']).toBe('KEY');
    // Timestamp must be seconds, and must match what the digest was computed over.
    expect(headers['X-Auth-Date']).toBe('1700000000');
    expect(headers.Authorization).toMatch(/^[0-9a-f]{40}$/);
  });

  it('produces a different digest as time advances', async () => {
    const a = await podcastIndexAuthHeaders({ key: 'K', secret: 'S' }, 1_700_000_000_000);
    const b = await podcastIndexAuthHeaders({ key: 'K', secret: 'S' }, 1_700_000_060_000);
    expect(a.Authorization).not.toBe(b.Authorization);
  });
});

describe('searchPodcastIndexShows', () => {
  it('returns [] without credentials and makes no request', async () => {
    expect(await searchPodcastIndexShows('anything')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps feeds to catalog shows', async () => {
    savePodcastIndexCredentials({ key: 'k', secret: 's' });
    mockFetch.mockResolvedValue(
      jsonResponse({
        feeds: [
          {
            id: 42,
            title: 'Indie Show',
            author: 'Someone',
            url: 'https://example.com/feed.xml',
            artwork: 'https://example.com/a.jpg',
          },
        ],
      }),
    );
    const shows = await searchPodcastIndexShows('indie');
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({
      title: 'Indie Show',
      feedUrl: 'https://example.com/feed.xml',
      source: 'podcastindex',
    });
  });

  it('drops feeds with no usable feed url', async () => {
    savePodcastIndexCredentials({ key: 'k', secret: 's' });
    mockFetch.mockResolvedValue(jsonResponse({ feeds: [{ id: 1, title: 'No URL' }] }));
    expect(await searchPodcastIndexShows('x')).toEqual([]);
  });

  it('falls back quietly when throttled or rejected', async () => {
    savePodcastIndexCredentials({ key: 'k', secret: 's' });
    mockFetch.mockResolvedValue(jsonResponse({}, 429));
    expect(await searchPodcastIndexShows('x')).toEqual([]);
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    expect(await searchPodcastIndexShows('x')).toEqual([]);
  });

  it('never throws when the request blows up', async () => {
    savePodcastIndexCredentials({ key: 'k', secret: 's' });
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(searchPodcastIndexShows('x')).resolves.toEqual([]);
  });
});

describe('testPodcastIndexCredentials', () => {
  it('reports missing credentials', async () => {
    expect(await testPodcastIndexCredentials({ key: '', secret: '' })).toMatchObject({
      ok: false,
    });
  });

  it('distinguishes rejection from throttling', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    expect((await testPodcastIndexCredentials({ key: 'k', secret: 's' })).detail).toMatch(
      /check key/i,
    );
    mockFetch.mockResolvedValue(jsonResponse({}, 429));
    expect((await testPodcastIndexCredentials({ key: 'k', secret: 's' })).detail).toMatch(
      /rate limited/i,
    );
  });

  it('reports success', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ feeds: [] }));
    expect(await testPodcastIndexCredentials({ key: 'k', secret: 's' })).toMatchObject({
      ok: true,
    });
  });
});
