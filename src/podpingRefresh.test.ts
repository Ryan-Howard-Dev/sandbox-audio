/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./airGapMode', () => ({ isAirGapEnabled: vi.fn(() => false) }));
vi.mock('./podcastRss', () => ({ fetchPodcastFeed: vi.fn() }));
vi.mock('./podcastStorage', () => ({
  loadSubscriptions: vi.fn(() => []),
  saveEpisodesForFeed: vi.fn(),
}));

import { isAirGapEnabled } from './airGapMode';
import { fetchPodcastFeed } from './podcastRss';
import { loadSubscriptions, saveEpisodesForFeed } from './podcastStorage';
import {
  createHiveRpc,
  refreshFeedsForUpdates,
  startPodpingRefresh,
  stopPodpingRefresh,
  subscribedFeedUrls,
} from './podpingRefresh';
import type { PodpingUpdate } from './podping';

const update = (iri: string): PodpingUpdate => ({ iri, reason: 'update', medium: 'podcast' });

const sub = (id: string, feedUrl: string) => ({ id, feedUrl, title: id, subscribedAt: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAirGapEnabled).mockReturnValue(false);
  vi.mocked(loadSubscriptions).mockReturnValue([] as never);
  stopPodpingRefresh();
});

describe('subscribedFeedUrls', () => {
  it('lists followed feed urls and drops blanks', () => {
    vi.mocked(loadSubscriptions).mockReturnValue([
      sub('a', 'https://a.example/f.xml'),
      sub('b', '   '),
    ] as never);
    expect(subscribedFeedUrls()).toEqual(['https://a.example/f.xml']);
  });
});

describe('refreshFeedsForUpdates', () => {
  it('refetches only the announced feed and stores its episodes', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([
      sub('feed-a', 'https://a.example/f.xml'),
      sub('feed-b', 'https://b.example/f.xml'),
    ] as never);
    vi.mocked(fetchPodcastFeed).mockResolvedValue({ episodes: [{ id: 'e1' }] } as never);

    const count = await refreshFeedsForUpdates([update('https://a.example/f.xml')]);

    expect(count).toBe(1);
    expect(fetchPodcastFeed).toHaveBeenCalledTimes(1);
    expect(fetchPodcastFeed).toHaveBeenCalledWith('https://a.example/f.xml');
    expect(saveEpisodesForFeed).toHaveBeenCalledWith('feed-a', [{ id: 'e1' }]);
  });

  /* Subscriptions can be removed between the watcher reading them and this running. */
  it('ignores an announcement for a feed no longer followed', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([sub('feed-a', 'https://a.example/f.xml')] as never);
    expect(await refreshFeedsForUpdates([update('https://gone.example/f.xml')])).toBe(0);
    expect(fetchPodcastFeed).not.toHaveBeenCalled();
  });

  it('matches regardless of trailing slash or case', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([sub('feed-a', 'https://A.example/f.xml/')] as never);
    vi.mocked(fetchPodcastFeed).mockResolvedValue({ episodes: [{ id: 'e1' }] } as never);
    expect(await refreshFeedsForUpdates([update('https://a.example/f.xml')])).toBe(1);
  });

  it('fetches a repeated announcement once', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([sub('feed-a', 'https://a.example/f.xml')] as never);
    vi.mocked(fetchPodcastFeed).mockResolvedValue({ episodes: [{ id: 'e1' }] } as never);

    await refreshFeedsForUpdates([update('https://a.example/f.xml'), update('https://a.example/f.xml')]);

    expect(fetchPodcastFeed).toHaveBeenCalledTimes(1);
  });

  /*
   * A publisher can announce seconds before their CDN serves the new file. That is a normal race,
   * not a reason to abandon the rest of the batch.
   */
  it('keeps going when one feed fails', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([
      sub('feed-a', 'https://a.example/f.xml'),
      sub('feed-b', 'https://b.example/f.xml'),
    ] as never);
    vi.mocked(fetchPodcastFeed)
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ episodes: [{ id: 'e2' }] } as never);

    const count = await refreshFeedsForUpdates([
      update('https://a.example/f.xml'),
      update('https://b.example/f.xml'),
    ]);

    expect(count).toBe(1);
    expect(saveEpisodesForFeed).toHaveBeenCalledWith('feed-b', [{ id: 'e2' }]);
  });

  it('stores nothing when the refetched feed has no episodes', async () => {
    vi.mocked(loadSubscriptions).mockReturnValue([sub('feed-a', 'https://a.example/f.xml')] as never);
    vi.mocked(fetchPodcastFeed).mockResolvedValue({ episodes: [] } as never);
    expect(await refreshFeedsForUpdates([update('https://a.example/f.xml')])).toBe(0);
    expect(saveEpisodesForFeed).not.toHaveBeenCalled();
  });

  it('does nothing at all under air gap', async () => {
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    vi.mocked(loadSubscriptions).mockReturnValue([sub('feed-a', 'https://a.example/f.xml')] as never);
    expect(await refreshFeedsForUpdates([update('https://a.example/f.xml')])).toBe(0);
    expect(fetchPodcastFeed).not.toHaveBeenCalled();
  });
});

describe('createHiveRpc', () => {
  it('rotates past a failing node and returns the result', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { head_block_number: 42 } }) });
    vi.stubGlobal('fetch', fetchMock);

    const rpc = createHiveRpc(['https://dead.example', 'https://live.example']);
    await expect(rpc('condenser_api.get_dynamic_global_properties', [])).resolves.toEqual({
      head_block_number: 42,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('throws only once every node has been tried', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);

    const rpc = createHiveRpc(['https://a.example', 'https://b.example']);
    await expect(rpc('x', [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('treats a JSON-RPC error payload as a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ error: { message: 'bad' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHiveRpc(['https://a.example'])('x', [])).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('startPodpingRefresh', () => {
  it('refuses to start under air gap', () => {
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    expect(startPodpingRefresh(vi.fn())).toBeNull();
  });

  it('starts once and returns the same watcher', () => {
    const rpc = vi.fn(async () => null);
    const first = startPodpingRefresh(rpc);
    const second = startPodpingRefresh(rpc);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    stopPodpingRefresh();
  });
});
