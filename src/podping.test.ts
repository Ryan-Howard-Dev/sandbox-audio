import { describe, expect, it } from 'vitest';
import {
  parsePodpingOperation,
  podpingUpdatesForSubscriptions,
  podpingUpdatesFromBlock,
} from './podping';

/*
 * Podping replaces polling every feed with one stream of publisher announcements. The parsing is
 * where it can quietly fail: an unrecognised payload shape yields nothing, which looks identical
 * to a quiet chain. These pin every shape that has been in use, because a watcher that silently
 * ignores half the network is worse than no watcher at all.
 */

describe('parsePodpingOperation', () => {
  it('reads the current iris payload', () => {
    expect(
      parsePodpingOperation({
        id: 'podping',
        json: JSON.stringify({
          version: '1.0',
          medium: 'podcast',
          reason: 'update',
          iris: ['https://example.com/feed.xml'],
        }),
      }),
    ).toEqual([{ iri: 'https://example.com/feed.xml', reason: 'update', medium: 'podcast' }]);
  });

  it('reads the older urls array and the bare url', () => {
    expect(
      parsePodpingOperation({ id: 'podping', json: '{"urls":["https://a.example/f.xml"]}' })[0]?.iri,
    ).toBe('https://a.example/f.xml');
    expect(
      parsePodpingOperation({ id: 'podping', json: '{"url":"https://b.example/f.xml"}' })[0]?.iri,
    ).toBe('https://b.example/f.xml');
  });

  it('takes reason and medium from a namespaced id when the payload omits them', () => {
    const [update] = parsePodpingOperation({
      id: 'pp_audiobook_update',
      json: '{"iris":["https://example.com/book.xml"]}',
    });
    expect(update?.medium).toBe('audiobook');
    expect(update?.reason).toBe('update');
  });

  it('accepts an already-parsed object as well as a JSON string', () => {
    expect(
      parsePodpingOperation({
        id: 'podping',
        json: { iris: ['https://example.com/feed.xml'], medium: 'music', reason: 'live' },
      }),
    ).toEqual([{ iri: 'https://example.com/feed.xml', reason: 'live', medium: 'music' }]);
  });

  it('ignores operations that are not podping', () => {
    expect(parsePodpingOperation({ id: 'follow', json: '{"iris":["https://x/f.xml"]}' })).toEqual(
      [],
    );
  });

  /* One publisher writing malformed JSON must not stop the rest of the block being read. */
  it('yields nothing for malformed payloads instead of throwing', () => {
    expect(parsePodpingOperation({ id: 'podping', json: '{not json' })).toEqual([]);
    expect(parsePodpingOperation({ id: 'podping', json: '[]' })).toEqual([]);
    expect(parsePodpingOperation({ id: 'podping' })).toEqual([]);
    expect(parsePodpingOperation({})).toEqual([]);
  });

  /* Only fetchable feeds. A non-http scheme is not something this app can act on. */
  it('drops entries that are not http feeds', () => {
    expect(
      parsePodpingOperation({
        id: 'podping',
        json: '{"iris":["ipfs://abc","","https://ok.example/f.xml","javascript:alert(1)"]}',
      }).map((u) => u.iri),
    ).toEqual(['https://ok.example/f.xml']);
  });

  it('marks an unrecognised reason and medium as unknown rather than guessing', () => {
    const [update] = parsePodpingOperation({
      id: 'podping',
      json: '{"iris":["https://x.example/f.xml"],"reason":"sideways","medium":"hologram"}',
    });
    expect(update?.reason).toBe('unknown');
    expect(update?.medium).toBe('unknown');
  });
});

describe('podpingUpdatesFromBlock', () => {
  it('collects updates across operations and drops repeats', () => {
    const updates = podpingUpdatesFromBlock([
      { id: 'podping', json: '{"iris":["https://a.example/f.xml"],"reason":"update"}' },
      { id: 'podping', json: '{"iris":["https://a.example/f.xml"],"reason":"update"}' },
      { id: 'podping', json: '{"iris":["https://b.example/f.xml"],"reason":"update"}' },
      { id: 'vote', json: '{}' },
    ]);
    expect(updates.map((u) => u.iri)).toEqual([
      'https://a.example/f.xml',
      'https://b.example/f.xml',
    ]);
  });

  it('keeps the same feed when the reason differs', () => {
    const updates = podpingUpdatesFromBlock([
      { id: 'podping', json: '{"iris":["https://a.example/f.xml"],"reason":"live"}' },
      { id: 'podping', json: '{"iris":["https://a.example/f.xml"],"reason":"liveEnd"}' },
    ]);
    expect(updates).toHaveLength(2);
  });

  it('handles an absent or empty operation list', () => {
    expect(podpingUpdatesFromBlock(null)).toEqual([]);
    expect(podpingUpdatesFromBlock([])).toEqual([]);
  });
});

describe('podpingUpdatesForSubscriptions', () => {
  const updates = podpingUpdatesFromBlock([
    { id: 'podping', json: '{"iris":["https://mine.example/feed.xml"],"reason":"update"}' },
    { id: 'podping', json: '{"iris":["https://stranger.example/feed.xml"],"reason":"update"}' },
  ]);

  it('keeps only feeds this install follows', () => {
    expect(
      podpingUpdatesForSubscriptions(updates, ['https://mine.example/feed.xml']).map((u) => u.iri),
    ).toEqual(['https://mine.example/feed.xml']);
  });

  it('matches regardless of case or a trailing slash', () => {
    expect(
      podpingUpdatesForSubscriptions(updates, ['HTTPS://Mine.Example/feed.xml/']),
    ).toHaveLength(1);
  });

  /* Nothing followed means nothing to fetch — never act on a stranger's announcement. */
  it('returns nothing when there are no subscriptions', () => {
    expect(podpingUpdatesForSubscriptions(updates, [])).toEqual([]);
  });
});
