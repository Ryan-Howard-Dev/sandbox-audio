/**
 * Lightweight RSS/Atom parser for Tier34 podcast mirror (no DOM).
 */

import { episodeIdFromGuid, subscriptionFeedUrlId } from './podcastMirrorIds.js';

export type ParsedMirrorEpisode = {
  id: string;
  guid: string;
  title: string;
  description?: string;
  audioUrl: string;
  audioType?: string;
  durationSeconds?: number;
  publishedAt?: number;
  artworkUrl?: string;
};

export type ParsedMirrorFeed = {
  feedId: string;
  feedUrl: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  episodes: ParsedMirrorEpisode[];
};

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripCdata(raw: string): string {
  const m = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : raw;
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeXmlEntities(stripCdata(m[1].trim()));
}

function tagAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

function parseDuration(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function parseDate(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function splitBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

function findEnclosure(item: string): { url: string; type?: string } | null {
  const url = tagAttr(item, 'enclosure', 'url');
  if (url) {
    return { url, type: tagAttr(item, 'enclosure', 'type') || undefined };
  }
  const linkRe = /<link[^>]+rel=["']enclosure["'][^>]*>/i;
  const linkMatch = item.match(linkRe);
  if (linkMatch) {
    const href = linkMatch[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      const type = linkMatch[0].match(/type=["']([^"']+)["']/i)?.[1];
      return { url: decodeXmlEntities(href), type };
    }
  }
  return null;
}

function parseRss(xml: string, feedUrl: string, feedId: string): ParsedMirrorFeed {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channel = channelMatch?.[1] ?? xml;
  const title = tagText(channel, 'title') || 'Podcast';
  const description =
    tagText(channel, 'description') || tagText(channel, 'itunes:summary') || tagText(channel, 'summary');
  const artworkUrl =
    tagAttr(channel, 'itunes:image', 'href') ||
    tagText(channel, 'image') ||
    tagAttr(channel, 'image', 'href') ||
    undefined;

  const episodes: ParsedMirrorEpisode[] = [];
  for (const item of splitBlocks(xml, 'item')) {
    const enc = findEnclosure(item);
    if (!enc?.url) continue;
    const guid =
      tagText(item, 'guid') ||
      tagAttr(item, 'link', 'href') ||
      tagText(item, 'link') ||
      enc.url;
    const epTitle = tagText(item, 'title') || 'Episode';
    const pubDate = parseDate(tagText(item, 'pubDate'));
    const duration = parseDuration(
      tagText(item, 'itunes:duration') || tagText(item, 'duration'),
    );
    const epArt = tagAttr(item, 'itunes:image', 'href') || artworkUrl || undefined;
    episodes.push({
      id: episodeIdFromGuid(feedId, guid, enc.url),
      guid,
      title: epTitle,
      description:
        tagText(item, 'description') ||
        tagText(item, 'itunes:summary') ||
        tagText(item, 'summary') ||
        undefined,
      audioUrl: enc.url,
      audioType: enc.type,
      durationSeconds: duration,
      publishedAt: pubDate,
      artworkUrl: epArt,
    });
  }

  return {
    feedId,
    feedUrl,
    title,
    description: description || undefined,
    artworkUrl,
    episodes: episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
  };
}

function parseAtom(xml: string, feedUrl: string, feedId: string): ParsedMirrorFeed {
  const feedMatch = xml.match(/<feed[^>]*>([\s\S]*?)<\/feed>/i);
  const feed = feedMatch?.[1] ?? xml;
  const title = tagText(feed, 'title') || 'Podcast';
  const description = tagText(feed, 'subtitle') || tagText(feed, 'summary') || undefined;
  const artworkUrl = tagAttr(feed, 'logo', 'href') || tagAttr(feed, 'icon', 'href') || undefined;

  const episodes: ParsedMirrorEpisode[] = [];
  for (const entry of splitBlocks(xml, 'entry')) {
    const linkRe = /<link[^>]*>/gi;
    let audioUrl = '';
    let audioType: string | undefined;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(entry)) !== null) {
      const tag = m[0];
      const type = tag.match(/type=["']([^"']+)["']/i)?.[1] ?? '';
      const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? '';
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      if (type.startsWith('audio') || rel === 'enclosure') {
        audioUrl = decodeXmlEntities(href);
        audioType = type || undefined;
        break;
      }
    }
    if (!audioUrl) continue;
    const guid =
      tagText(entry, 'id') ||
      tagAttr(entry, 'link', 'href') ||
      audioUrl;
    const epTitle = tagText(entry, 'title') || 'Episode';
    const pubDate = parseDate(tagText(entry, 'published') || tagText(entry, 'updated'));
    episodes.push({
      id: episodeIdFromGuid(feedId, guid, audioUrl),
      guid,
      title: epTitle,
      description: tagText(entry, 'summary') || tagText(entry, 'content') || undefined,
      audioUrl,
      audioType,
      publishedAt: pubDate,
      artworkUrl,
    });
  }

  return {
    feedId,
    feedUrl,
    title,
    description,
    artworkUrl,
    episodes: episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
  };
}

export function parsePodcastMirrorFeedXml(xml: string, feedUrl: string): ParsedMirrorFeed {
  const trimmed = feedUrl.trim();
  const feedId = subscriptionFeedUrlId(trimmed);
  if (/<feed[\s>]/i.test(xml)) {
    return parseAtom(xml, trimmed, feedId);
  }
  return parseRss(xml, trimmed, feedId);
}

export function buildMirroredRssXml(
  feed: ParsedMirrorFeed,
  mirroredEpisodes: Array<ParsedMirrorEpisode & { blobUrl: string; blobHash: string }>,
  baseUrl: string,
): string {
  const origin = baseUrl.replace(/\/$/, '');
  const channelArt = feed.artworkUrl
    ? `<itunes:image href="${escapeXml(feed.artworkUrl)}"/>`
    : '';
  const items = mirroredEpisodes
    .map((ep) => {
      const pub =
        ep.publishedAt != null
          ? `<pubDate>${new Date(ep.publishedAt).toUTCString()}</pubDate>`
          : '';
      const duration =
        ep.durationSeconds != null
          ? `<itunes:duration>${ep.durationSeconds}</itunes:duration>`
          : '';
      const desc = ep.description
        ? `<description><![CDATA[${ep.description}]]></description>`
        : '';
      const blobUrl = ep.blobUrl.startsWith('http')
        ? ep.blobUrl
        : `${origin}${ep.blobUrl.startsWith('/') ? '' : '/'}${ep.blobUrl}`;
      return `<item>
  <title>${escapeXml(ep.title)}</title>
  <guid isPermaLink="false">${escapeXml(ep.guid)}</guid>
  ${pub}
  ${duration}
  ${desc}
  <enclosure url="${escapeXml(blobUrl)}" type="${escapeXml(ep.audioType ?? 'audio/mpeg')}" length="0"/>
  <sandbox:mirror hash="${escapeXml(ep.blobHash)}"/>
</item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:sandbox="https://sandbox.music/ns/podcast-mirror">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    ${feed.description ? `<description>${escapeXml(feed.description)}</description>` : ''}
    <link>${escapeXml(feed.feedUrl)}</link>
    ${channelArt}
    <sandbox:mirror>lan-cache</sandbox:mirror>
    ${items}
  </channel>
</rss>`;
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
