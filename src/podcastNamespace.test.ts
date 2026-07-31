/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  feedAllowsImport,
  parsePodcastChannelTags,
  parsePodcastItemTags,
  preferredTranscript,
} from './podcastNamespace';

const feed = (channelBody: string, prefix = 'podcast'): string => `<?xml version="1.0"?>
<rss version="2.0" xmlns:${prefix}="https://podcastindex.org/namespace/1.0">
  <channel><title>A Show</title>${channelBody}</channel>
</rss>`;

const item = (body: string): string => `<?xml version="1.0"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel><item><title>An Episode</title>${body}</item></channel>
</rss>`;

/*
 * `locked` is the one tag in the namespace that constrains what this app may do, so it is tested
 * as a directive rather than as metadata: an explicit yes must refuse import, and it must be
 * readable no matter which prefix the publisher bound the namespace to.
 */
describe('podcast:locked', () => {
  it('refuses import when the publisher locked the feed', () => {
    const tags = parsePodcastChannelTags(
      feed('<podcast:locked owner="me@example.com">yes</podcast:locked>'),
    );
    expect(tags.locked).toBe(true);
    expect(tags.lockOwner).toBe('me@example.com');
    expect(feedAllowsImport(tags)).toBe(false);
  });

  it('permits import when the publisher explicitly unlocked it', () => {
    const tags = parsePodcastChannelTags(feed('<podcast:locked>no</podcast:locked>'));
    expect(tags.locked).toBe(false);
    expect(feedAllowsImport(tags)).toBe(true);
  });

  /*
   * The tag postdates almost every feed in existence, and saying nothing has always meant an open
   * feed. Treating absence as a refusal would lock out the entire existing ecosystem.
   */
  it('permits import when the tag is absent', () => {
    const tags = parsePodcastChannelTags(feed(''));
    expect(tags.locked).toBeUndefined();
    expect(feedAllowsImport(tags)).toBe(true);
  });

  /* The prefix is the feed author's choice; only the namespace is fixed. */
  it('reads the lock under a non-standard prefix', () => {
    const xml = feed('<pi:locked>yes</pi:locked>', 'pi');
    expect(feedAllowsImport(parsePodcastChannelTags(xml))).toBe(false);
  });

  it('accepts the alternate truthy spellings', () => {
    for (const value of ['yes', 'true', '1', 'YES']) {
      expect(parsePodcastChannelTags(feed(`<podcast:locked>${value}</podcast:locked>`)).locked).toBe(
        true,
      );
    }
  });

  it('survives malformed XML without claiming the feed is locked', () => {
    const tags = parsePodcastChannelTags('<rss><channel>');
    expect(tags.locked).toBeUndefined();
    expect(feedAllowsImport(tags)).toBe(true);
  });
});

describe('channel tags', () => {
  it('reads people, funding, medium and guid', () => {
    const tags = parsePodcastChannelTags(
      feed(`
        <podcast:guid>abc-123</podcast:guid>
        <podcast:medium>audiobook</podcast:medium>
        <podcast:person role="host" img="https://x/h.jpg">Alice</podcast:person>
        <podcast:person role="producer">Bob</podcast:person>
        <podcast:funding url="https://example.com/support">Support the show</podcast:funding>
      `),
    );
    expect(tags.guid).toBe('abc-123');
    expect(tags.medium).toBe('audiobook');
    expect(tags.persons.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(tags.persons[0]?.role).toBe('host');
    expect(tags.funding[0]).toEqual({ url: 'https://example.com/support', label: 'Support the show' });
  });

  /* A recommendation graph built from what publishers endorse, not from inferred behaviour. */
  it('reads the podroll as feed urls', () => {
    const tags = parsePodcastChannelTags(
      feed(`<podcast:podroll>
        <podcast:remoteItem feedUrl="https://a.example/f.xml"/>
        <podcast:remoteItem feedUrl="https://b.example/f.xml"/>
      </podcast:podroll>`),
    );
    expect(tags.podroll).toEqual(['https://a.example/f.xml', 'https://b.example/f.xml']);
  });

  it('drops a person with no name and funding with no url', () => {
    const tags = parsePodcastChannelTags(
      feed('<podcast:person role="host"></podcast:person><podcast:funding>No link</podcast:funding>'),
    );
    expect(tags.persons).toEqual([]);
    expect(tags.funding).toEqual([]);
  });
});

describe('item tags', () => {
  it('reads transcripts, chapters, season and episode', () => {
    const tags = parsePodcastItemTags(
      item(`
        <podcast:transcript url="https://x/t.json" type="application/json" language="en"/>
        <podcast:chapters url="https://x/c.json" type="application/json+chapters"/>
        <podcast:season>3</podcast:season>
        <podcast:episode>12</podcast:episode>
      `),
    );
    expect(tags.transcripts[0]?.url).toBe('https://x/t.json');
    expect(tags.chaptersUrl).toBe('https://x/c.json');
    expect(tags.season).toBe(3);
    expect(tags.episode).toBe(12);
  });

  it('reads soundbites as timeline marks', () => {
    const tags = parsePodcastItemTags(
      item('<podcast:soundbite startTime="73.5" duration="42">The good bit</podcast:soundbite>'),
    );
    expect(tags.soundbites).toEqual([{ startTime: 73.5, duration: 42, title: 'The good bit' }]);
  });

  /* Without a real start and length there is nothing to play or draw. */
  it('drops a soundbite missing its timings', () => {
    const tags = parsePodcastItemTags(
      item('<podcast:soundbite duration="0">Nope</podcast:soundbite>'),
    );
    expect(tags.soundbites).toEqual([]);
  });

  it('reads the social interact uri for federated discussion', () => {
    const tags = parsePodcastItemTags(
      item('<podcast:socialInteract uri="https://mastodon.example/@a/1" protocol="activitypub"/>'),
    );
    expect(tags.socialInteractUrl).toBe('https://mastodon.example/@a/1');
  });

  it('returns empty collections for an episode with no namespace tags', () => {
    const tags = parsePodcastItemTags(item(''));
    expect(tags.transcripts).toEqual([]);
    expect(tags.soundbites).toEqual([]);
    expect(tags.chaptersUrl).toBeUndefined();
  });
});

describe('preferredTranscript', () => {
  /* JSON carries speaker labels and word timings — the difference between searchable and readable. */
  it('prefers JSON over VTT and SRT', () => {
    const chosen = preferredTranscript([
      { url: 'a.srt', type: 'application/x-subrip' },
      { url: 'b.vtt', type: 'text/vtt' },
      { url: 'c.json', type: 'application/json' },
    ]);
    expect(chosen?.url).toBe('c.json');
  });

  it('deprioritises a captions-only transcript against an equal alternative', () => {
    const chosen = preferredTranscript([
      { url: 'captions.vtt', type: 'text/vtt', rel: 'captions' },
      { url: 'full.vtt', type: 'text/vtt' },
    ]);
    expect(chosen?.url).toBe('full.vtt');
  });

  it('is null when the episode offers none', () => {
    expect(preferredTranscript([])).toBeNull();
  });
});
