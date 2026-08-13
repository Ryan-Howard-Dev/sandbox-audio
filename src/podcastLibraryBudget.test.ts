// @vitest-environment jsdom
/**
 * A ceiling for the podcast library as a whole, not just for one show.
 *
 * The per-feed cap bounds a single enormous feed and nothing else, so the real size of the library
 * is the number of subscriptions: forty shows at a hundred and twenty episodes each is the same
 * problem arriving more slowly. On a phone this key had reached 1.3MB, the largest single thing in
 * a store that had stopped accepting writes.
 *
 * What must never happen is losing something the listener owns. Subscriptions stay. Whether an
 * episode was played, and how far in, live in other keys entirely and are never touched here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_EPISODES_PERSISTED_PER_FEED,
  MAX_EPISODES_PERSISTED_TOTAL,
  MIN_EPISODES_PERSISTED_PER_FEED,
  episodesPerFeedBudget,
  prunePodcastLibraryToBudget,
} from './podcastStorage';

const LIBRARY_KEY = 'sandbox_podcast_library';

const episode = (feedId: string, n: number) => ({
  id: `${feedId}-ep${n}`,
  feedId,
  title: `Episode ${n}`,
  audioUrl: `https://example.invalid/${feedId}/${n}.mp3`,
  publishedAt: n,
});

const subscription = (id: string) => ({
  id,
  feedUrl: `https://example.invalid/${id}.xml`,
  title: `Show ${id}`,
  subscribedAt: 1,
});

function seedLibrary(feeds: number, episodesEach: number) {
  const subscriptions = Array.from({ length: feeds }, (_, i) => subscription(`f${i}`));
  const episodesByFeed: Record<string, ReturnType<typeof episode>[]> = {};
  for (let i = 0; i < feeds; i += 1) {
    episodesByFeed[`f${i}`] = Array.from({ length: episodesEach }, (_, n) => episode(`f${i}`, n));
  }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ subscriptions, episodesByFeed }));
}

function readLibraryRaw() {
  return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}') as {
    subscriptions: { id: string }[];
    episodesByFeed: Record<string, { id: string; publishedAt: number }[]>;
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('episodesPerFeedBudget', () => {
  it('gives a single show the full per-feed cap', () => {
    expect(episodesPerFeedBudget(1)).toBe(MAX_EPISODES_PERSISTED_PER_FEED);
    expect(episodesPerFeedBudget(0)).toBe(MAX_EPISODES_PERSISTED_PER_FEED);
  });

  it('shares the budget out as the library widens', () => {
    // Ten shows still fit comfortably; forty do not, and each keeps proportionally fewer.
    expect(episodesPerFeedBudget(10)).toBe(MAX_EPISODES_PERSISTED_PER_FEED);
    expect(episodesPerFeedBudget(40)).toBe(Math.floor(MAX_EPISODES_PERSISTED_TOTAL / 40));
    expect(episodesPerFeedBudget(40)).toBeLessThan(MAX_EPISODES_PERSISTED_PER_FEED);
  });

  it('never starves a show, even at a hundred subscriptions', () => {
    // A strict share would leave twelve episodes each, which is not a podcast app any more.
    expect(episodesPerFeedBudget(100)).toBe(MIN_EPISODES_PERSISTED_PER_FEED);
  });
});

describe('prunePodcastLibraryToBudget', () => {
  it('does nothing to a library that already fits', () => {
    seedLibrary(3, 10);
    expect(prunePodcastLibraryToBudget()).toBe(0);
    expect(readLibraryRaw().episodesByFeed.f0).toHaveLength(10);
  });

  it('brings a wide library back inside the budget', () => {
    seedLibrary(40, 120);
    const dropped = prunePodcastLibraryToBudget();
    expect(dropped).toBeGreaterThan(0);

    const lib = readLibraryRaw();
    const total = Object.values(lib.episodesByFeed).reduce((sum, eps) => sum + eps.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_EPISODES_PERSISTED_TOTAL);
  });

  it('keeps the newest episodes of each show', () => {
    seedLibrary(40, 120);
    prunePodcastLibraryToBudget();
    const kept = readLibraryRaw().episodesByFeed.f0;
    const oldest = Math.min(...kept.map((e) => e.publishedAt));
    const newest = Math.max(...kept.map((e) => e.publishedAt));
    expect(newest).toBe(119);
    expect(oldest).toBeGreaterThan(0);
  });

  it('never drops a subscription', () => {
    /*
     * The line that must not be crossed. Unsubscribing is a decision, and a storage budget does
     * not get to make it: an episode list comes back on the next feed refresh, a subscription
     * does not come back at all.
     */
    seedLibrary(40, 120);
    prunePodcastLibraryToBudget();
    expect(readLibraryRaw().subscriptions).toHaveLength(40);
  });

  it('leaves played state and resume positions alone', () => {
    // Those live in their own keys. Losing an episode record must never lose your place in it.
    seedLibrary(40, 120);
    localStorage.setItem('sandbox_podcast_playback_state_v1', JSON.stringify({ 'f0-ep3': { completed: true } }));
    localStorage.setItem('sandbox_podcast_resume', JSON.stringify({ 'f0-ep3': 1234 }));
    prunePodcastLibraryToBudget();
    expect(JSON.parse(localStorage.getItem('sandbox_podcast_playback_state_v1')!)).toEqual({
      'f0-ep3': { completed: true },
    });
    expect(JSON.parse(localStorage.getItem('sandbox_podcast_resume')!)).toEqual({ 'f0-ep3': 1234 });
  });

  it('is safe to call repeatedly', () => {
    seedLibrary(40, 120);
    prunePodcastLibraryToBudget();
    // Second pass has nothing left to do, so it must not rewrite a megabyte for nothing.
    expect(prunePodcastLibraryToBudget()).toBe(0);
  });

  it('copes with an empty library', () => {
    expect(prunePodcastLibraryToBudget()).toBe(0);
  });
});

describe('show notes are where the library actually sits', () => {
  const bigNotes = 'x'.repeat(2400);

  function seedWithNotes(feeds: number, episodesEach: number) {
    const subscriptions = Array.from({ length: feeds }, (_, i) => subscription(`f${i}`));
    const episodesByFeed: Record<string, Record<string, unknown>[]> = {};
    for (let i = 0; i < feeds; i += 1) {
      episodesByFeed[`f${i}`] = Array.from({ length: episodesEach }, (_, n) => ({
        ...episode(`f${i}`, episodesEach - n),
        description: bigNotes,
      }));
    }
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ subscriptions, episodesByFeed }));
  }

  it('keeps the newest episodes readable and slims the rest', async () => {
    /*
     * Measured on a real phone: an episode record is about 2.9KB and 2.4KB of it is the
     * description. Two subscriptions came to 1.3MB, so capping episode counts alone would have
     * reclaimed nothing -- there were only 240 episodes.
     */
    const { EPISODES_WITH_FULL_NOTES_PER_FEED } = await import('./podcastStorage');
    seedWithNotes(2, 120);
    const before = (localStorage.getItem(LIBRARY_KEY) || '').length;

    expect(prunePodcastLibraryToBudget()).toBeGreaterThan(0);

    const after = (localStorage.getItem(LIBRARY_KEY) || '').length;
    expect(after).toBeLessThan(before / 2);

    const kept = readLibraryRaw().episodesByFeed.f0 as unknown as { description?: string }[];
    expect(kept).toHaveLength(120);
    expect(kept[0].description).toBe(bigNotes);
    expect(kept[EPISODES_WITH_FULL_NOTES_PER_FEED - 1].description).toBe(bigNotes);
    expect(kept[EPISODES_WITH_FULL_NOTES_PER_FEED].description).toBeUndefined();
  });

  it('leaves everything playback needs on a slimmed episode', async () => {
    // Title, artwork, duration and audio url are what the list shows and what playback starts
    // from. Only the prose goes.
    seedWithNotes(2, 120);
    prunePodcastLibraryToBudget();
    const slim = (readLibraryRaw().episodesByFeed.f0 as unknown as Record<string, unknown>[])[119];
    expect(slim.id).toBeTruthy();
    expect(slim.audioUrl).toBeTruthy();
    expect(slim.title).toBeTruthy();
    expect(slim.description).toBeUndefined();
  });

  it('settles, so the timer is not rewriting the library every five minutes', () => {
    seedWithNotes(2, 120);
    prunePodcastLibraryToBudget();
    expect(prunePodcastLibraryToBudget()).toBe(0);
  });
});
