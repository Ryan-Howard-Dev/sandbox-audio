/**
 * Podcast Index episode metadata — chaptersUrl and soundbites when RSS omits them.
 */

import { createHash } from 'node:crypto';

const PODCAST_INDEX_BASE = 'https://api.podcastindex.org/api/1.0';

export interface PodcastIndexSoundbite {
  startTime: number;
  duration?: number;
  title?: string;
}

export interface PodcastEpisodeMetaResult {
  chaptersUrl?: string;
  soundbites: PodcastIndexSoundbite[];
}

function podcastIndexConfigured(): { key: string; secret: string } | null {
  const key = process.env.PODCAST_INDEX_KEY?.trim() ?? '';
  const secret = process.env.PODCAST_INDEX_SECRET?.trim() ?? '';
  if (!key || !secret) return null;
  return { key, secret };
}

function podcastIndexHeaders(key: string, secret: string): Record<string, string> {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = createHash('sha1')
    .update(key + secret + apiHeaderTime)
    .digest('hex');
  return {
    'X-Auth-Date': String(apiHeaderTime),
    'X-Auth-Key': key,
    Authorization: hash,
    'User-Agent': 'SandboxTier34/1.0',
  };
}

type PiEpisodeItem = {
  chaptersUrl?: string;
  soundbite?: PodcastIndexSoundbite;
  soundbites?: PodcastIndexSoundbite[];
};

function normalizeSoundbites(item: PiEpisodeItem): PodcastIndexSoundbite[] {
  const out: PodcastIndexSoundbite[] = [];
  const push = (sb: PodcastIndexSoundbite | undefined) => {
    if (!sb || !Number.isFinite(sb.startTime) || sb.startTime < 0) return;
    out.push({
      startTime: sb.startTime,
      duration: sb.duration,
      title: sb.title?.trim() || undefined,
    });
  };
  push(item.soundbite);
  for (const sb of item.soundbites ?? []) push(sb);
  return out;
}

function itemToMeta(item: PiEpisodeItem | undefined): PodcastEpisodeMetaResult {
  if (!item) return { soundbites: [] };
  return {
    chaptersUrl: item.chaptersUrl?.trim() || undefined,
    soundbites: normalizeSoundbites(item),
  };
}

async function fetchPiEpisode(path: string): Promise<PodcastEpisodeMetaResult> {
  const auth = podcastIndexConfigured();
  if (!auth) return { soundbites: [] };
  const url = `${PODCAST_INDEX_BASE}${path}`;
  const res = await fetch(url, {
    headers: podcastIndexHeaders(auth.key, auth.secret),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return { soundbites: [] };
  const data = (await res.json()) as { item?: PiEpisodeItem; items?: PiEpisodeItem[] };
  const item = data.item ?? data.items?.[0];
  return itemToMeta(item);
}

/** Resolve PI chaptersUrl + soundbites for any subscribed episode. */
export async function fetchPodcastEpisodeMeta(opts: {
  feedUrl?: string;
  guid?: string;
  enclosureUrl?: string;
}): Promise<PodcastEpisodeMetaResult> {
  const guid = opts.guid?.trim();
  const enclosureUrl = opts.enclosureUrl?.trim();

  if (guid) {
    const byGuid = await fetchPiEpisode(
      `/episodes/byguid?guid=${encodeURIComponent(guid)}`,
    );
    if (byGuid.chaptersUrl || byGuid.soundbites.length > 0) return byGuid;
  }

  if (enclosureUrl) {
    const byUrl = await fetchPiEpisode(
      `/episodes/byurl?url=${encodeURIComponent(enclosureUrl)}`,
    );
    if (byUrl.chaptersUrl || byUrl.soundbites.length > 0) return byUrl;
  }

  return { soundbites: [] };
}
