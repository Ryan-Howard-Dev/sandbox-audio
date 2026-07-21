import { describe, expect, it, vi } from 'vitest';
import * as podcastStorage from './podcastStorage';
import {
  computeNextQueueIndexWithUpNext,
  mergeIntoUpNextQueue,
  type SovereignUpNextSettings,
} from './sovereignUpNext';
import type { MediaEnvelope } from './sandboxLayer1';

const baseSettings: SovereignUpNextSettings = {
  enabled: true,
  unplayedOnly: false,
  stopAfterEpisodes: 0,
  insertNewestAtTop: false,
};

function env(id: string, title: string): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist: 'Artist',
    url: 'https://example.com/a.mp3',
    durationSeconds: 200,
    provider: 'https',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('sovereignUpNext', () => {
  it('appends when insert-newest is off', () => {
    const queue = [env('a', 'A')];
    const next = mergeIntoUpNextQueue(queue, 0, [env('b', 'B'), env('c', 'C')], baseSettings);
    expect(next.map((e) => e.envelopeId)).toEqual(['a', 'b', 'c']);
  });

  it('inserts batch at top of up-next when enabled', () => {
    const queue = [env('a', 'A'), env('b', 'B'), env('c', 'C')];
    const settings = { ...baseSettings, insertNewestAtTop: true };
    const next = mergeIntoUpNextQueue(
      queue,
      0,
      [env('n1', 'N1'), env('n2', 'N2')],
      settings,
      'append',
    );
    expect(next.map((e) => e.envelopeId)).toEqual(['a', 'n2', 'n1', 'b', 'c']);
  });

  it('skips played podcast rows when unplayed-only advance', () => {
    vi.spyOn(podcastStorage, 'isEpisodeUnplayed').mockImplementation((id) => id === 'ep-fresh');
    const queue = [
      env('music:1', 'Song'),
      { ...env('podcast:feed-x:ep-played', 'Played ep'), envelopeId: 'podcast:feed-x:ep-played' },
      { ...env('podcast:feed-x:ep-fresh', 'Fresh ep'), envelopeId: 'podcast:feed-x:ep-fresh' },
    ];
    const settings = { ...baseSettings, unplayedOnly: true };
    const result = computeNextQueueIndexWithUpNext({
      queueIndex: 0,
      queueLength: queue.length,
      repeatMode: 'none',
      shuffleOn: false,
      queue,
      settings,
    });
    expect(result.action).toBe('advance');
    if (result.action === 'advance') {
      expect(result.index).toBe(2);
    }
    vi.restoreAllMocks();
  });
});
