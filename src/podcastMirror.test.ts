import { describe, expect, it } from 'vitest';
import { episodeIdFromGuid, subscriptionFeedUrlId } from '../tier34-server/lib/podcastMirrorIds';
import {
  buildMirroredRssXml,
  parsePodcastMirrorFeedXml,
} from '../tier34-server/lib/podcastMirrorParser';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Underground Hour</title>
    <description>Off-grid talk</description>
    <item>
      <title>Episode 1</title>
      <guid>ep-1-guid</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <itunes:duration>1:05:00</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
    </item>
  </channel>
</rss>`;

describe('podcastMirrorIds', () => {
  it('matches client feed id algorithm', () => {
    const url = 'https://feeds.example.com/show.rss';
    expect(subscriptionFeedUrlId(url)).toBe(subscriptionFeedUrlId(url.toUpperCase()));
    expect(subscriptionFeedUrlId(url)).toMatch(/^feed-/);
  });

  it('builds stable episode ids', () => {
    const feedId = 'feed-abc';
    const a = episodeIdFromGuid(feedId, 'guid-1', 'https://x.com/a.mp3');
    const b = episodeIdFromGuid(feedId, 'guid-1', 'https://x.com/a.mp3');
    expect(a).toBe(b);
    expect(a.startsWith(`${feedId}:ep-`)).toBe(true);
  });
});

describe('podcastMirrorParser', () => {
  it('parses RSS items with enclosure', () => {
    const feedUrl = 'https://feeds.example.com/show.rss';
    const parsed = parsePodcastMirrorFeedXml(SAMPLE_RSS, feedUrl);
    expect(parsed.title).toBe('Underground Hour');
    expect(parsed.episodes).toHaveLength(1);
    expect(parsed.episodes[0].title).toBe('Episode 1');
    expect(parsed.episodes[0].audioUrl).toContain('ep1.mp3');
    expect(parsed.episodes[0].durationSeconds).toBe(3900);
  });

  it('emits mirrored RSS with locker blob URLs', () => {
    const feedUrl = 'https://feeds.example.com/show.rss';
    const parsed = parsePodcastMirrorFeedXml(SAMPLE_RSS, feedUrl);
    const ep = parsed.episodes[0];
    const hash = 'a'.repeat(64);
    const xml = buildMirroredRssXml(
      parsed,
      [{ ...ep, blobHash: hash, blobUrl: `/api/locker/blob/${hash}` }],
      'http://192.168.1.10:3001',
    );
    expect(xml).toContain('sandbox:mirror');
    expect(xml).toContain(`/api/locker/blob/${hash}`);
    expect(xml).toContain('Episode 1');
  });
});
