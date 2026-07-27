/**
 * Curated audiobook RSS feeds — shared between Tier34 server and client.
 * Book Radio (bookradio.vercel.app) has no public RSS; LibriVox per-book RSS is used instead.
 */

export type AudiobookRssFeedKind = 'anthology' | 'book';

export type AudiobookCuratedRssFeed = {
  url: string;
  label: string;
  kind: AudiobookRssFeedKind;
  /** Override channel author when the feed omits it. */
  author?: string;
};

export const AUDIOBOOK_CURATED_RSS_FEEDS: AudiobookCuratedRssFeed[] = [
  {
    url: 'https://www.storynory.com/feeds/stories/',
    label: 'Storynory',
    kind: 'anthology',
    author: 'Storynory',
  },
  {
    // `label` is the displayed book title, not a feed description — it goes straight into the
    // catalog entry's title. "(LibriVox RSS)" was an internal disambiguator that leaked onto the
    // book card and the player, where the source is already shown as its own label.
    url: 'https://librivox.org/rss/253',
    label: 'Pride and Prejudice',
    kind: 'book',
    author: 'Jane Austen',
  },
];
