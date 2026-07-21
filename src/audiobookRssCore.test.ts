import { describe, expect, it } from 'vitest';
import {
  dedupeAudiobookBooks,
  rssChaptersFromFeed,
  searchRssFeed,
  type AudiobookRssParsedFeed,
} from '../tier34-server/lib/audiobookRssCore';
import { parsePodcastMirrorFeedXml } from '../tier34-server/lib/podcastMirrorParser';

const LOYAL_BOOKS_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Pride and Prejudice</title>
    <description>Jane Austen classic</description>
    <item>
      <title>Chapter 1</title>
      <guid>ch-1</guid>
      <enclosure url="https://cdn.example.com/ch1.mp3" type="audio/mpeg" length="0"/>
      <itunes:duration>12:30</itunes:duration>
    </item>
    <item>
      <title>Chapter 2</title>
      <guid>ch-2</guid>
      <enclosure url="https://cdn.example.com/ch2.mp3" type="audio/mpeg" length="0"/>
      <itunes:duration>10:00</itunes:duration>
    </item>
  </channel>
</rss>`;

const STORYNORY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Storynory</title>
    <description>Audio stories for kids</description>
    <item>
      <title>The Golden Fish</title>
      <guid>story-golden-fish</guid>
      <enclosure url="https://cdn.example.com/golden-fish.mp3" type="audio/mpeg" length="0"/>
    </item>
  </channel>
</rss>`;

function toRssFeed(xml: string, feedUrl: string): AudiobookRssParsedFeed {
  const parsed = parsePodcastMirrorFeedXml(xml, feedUrl);
  return {
    feedId: parsed.feedId,
    feedUrl: parsed.feedUrl,
    title: parsed.title,
    description: parsed.description,
    artworkUrl: parsed.artworkUrl,
    episodes: parsed.episodes.map((ep) => ({
      id: ep.id,
      guid: ep.guid,
      title: ep.title,
      description: ep.description,
      audioUrl: ep.audioUrl,
      durationSeconds: ep.durationSeconds,
      artworkUrl: ep.artworkUrl,
      publishedAt: ep.publishedAt,
    })),
  };
}

describe('audiobookRssCore', () => {
  it('maps book-style RSS feed to a single catalog book', () => {
    const feed = toRssFeed(LOYAL_BOOKS_RSS, 'https://www.loyalbooks.com/book/pride-and-prejudice/feed');
    const hits = searchRssFeed(feed, 'pride', 'book', {
      url: feed.feedUrl,
      label: 'Pride and Prejudice',
      kind: 'book',
      author: 'Jane Austen',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Pride and Prejudice');
    expect(hits[0].author).toBe('Jane Austen');
    expect(hits[0].source).toBe('rss');
    expect(hits[0].chapterCount).toBe(2);
  });

  it('maps anthology RSS items to individual books', () => {
    const feed = toRssFeed(STORYNORY_RSS, 'https://www.storynory.com/feeds/stories/');
    const hits = searchRssFeed(feed, 'golden', 'anthology', {
      url: feed.feedUrl,
      label: 'Storynory',
      kind: 'anthology',
      author: 'Storynory',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('The Golden Fish');
    expect(hits[0].chapterCount).toBe(1);
  });

  it('builds chapters for a book-style RSS feed', () => {
    const feed = toRssFeed(LOYAL_BOOKS_RSS, 'https://www.loyalbooks.com/book/pride-and-prejudice/feed');
    const book = searchRssFeed(feed, 'pride', 'book')[0]!;
    const chapters = rssChaptersFromFeed(book, feed);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Chapter 1');
    expect(chapters[0].audioUrl).toContain('ch1.mp3');
    expect(chapters[0].source).toBe('rss');
  });

  it('dedupes books by source title and author', () => {
    const a = {
      id: 'librivox:1',
      sourceId: '1',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      source: 'librivox' as const,
    };
    const b = { ...a, id: 'rss:feed-abc', source: 'rss' as const };
    expect(dedupeAudiobookBooks([a, b])).toHaveLength(2);
    expect(dedupeAudiobookBooks([a, { ...a, id: 'librivox:2' }])).toHaveLength(1);
  });
});
