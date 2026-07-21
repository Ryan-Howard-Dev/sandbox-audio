/**
 * Piped API — lightweight YouTube search + stream resolve (no yt-dlp init required).
 */

const PIPED_BASES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api-piped.mha.fi',
  'https://pipedapi.syncpundit.io',
];

export interface PipedSearchHit {
  id: string;
  title: string;
  artist: string;
  watchUrl: string;
  durationSeconds?: number;
  thumbnail?: string;
}

function pipedRelevance(title: string, artist: string, query: string): number {
  const hay = `${title} ${artist}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .replace(/[¥$,]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['dollar', 'sign', 'ty', 'dolla', 'ign'].includes(t));
  if (!tokens.length) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) hits += 1;
    else if (token === 'ye' && (hay.includes('kanye') || hay.includes(' ye '))) hits += 1;
    else if (token.startsWith('kany') && hay.includes('ye')) hits += 1;
  }
  return hits / tokens.length;
}

/** Search YouTube via public Piped instances (fast catalog supplement). */
export async function searchViaPipedMobile(
  query: string,
  limit = 8,
): Promise<PipedSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  for (const base of PIPED_BASES) {
    const root = base.replace(/\/$/, '');
    try {
      const res = await fetch(
        `${root}/search?q=${encodeURIComponent(q)}&filter=music_songs`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'SandboxMusic/1.0' },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        items?: Array<{
          url?: string;
          title?: string;
          uploaderName?: string;
          uploader?: string;
          duration?: number;
          thumbnail?: string;
        }>;
      };
      const hits: PipedSearchHit[] = [];
      for (const row of data.items ?? []) {
        const rawUrl = row.url?.trim() ?? '';
        const videoId =
          extractYoutubeVideoId(rawUrl) ??
          rawUrl.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/)?.[1] ??
          null;
        if (!videoId) continue;
        const title = (row.title ?? q).slice(0, 160);
        const artist = row.uploaderName ?? row.uploader ?? 'Unknown artist';
        if (pipedRelevance(title, artist, q) < 0.34) continue;
        hits.push({
          id: videoId,
          title,
          artist,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
          durationSeconds:
            typeof row.duration === 'number' && row.duration > 0 ? row.duration : undefined,
          thumbnail: row.thumbnail,
        });
        if (hits.length >= limit) break;
      }
      if (hits.length > 0) {
        console.log('[PipedMobile] search ok via', root, hits.length);
        return hits;
      }
    } catch {
      /* try next instance */
    }
  }
  return [];
}

const INVIDIOUS_BASES = [
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us',
  'https://inv.nadeko.net',
];

/** Search YouTube via public Invidious instances. */
export async function searchViaInvidiousMobile(
  query: string,
  limit = 8,
): Promise<PipedSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  for (const base of INVIDIOUS_BASES) {
    const root = base.replace(/\/$/, '');
    try {
      const res = await fetch(
        `${root}/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'SandboxMusic/1.0' },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Array<{
        videoId?: string;
        title?: string;
        author?: string;
        lengthSeconds?: number;
      }>;
      const hits: PipedSearchHit[] = [];
      for (const row of data ?? []) {
        if (!row.videoId) continue;
        const title = (row.title ?? q).slice(0, 160);
        const artist = row.author ?? 'Unknown artist';
        if (pipedRelevance(title, artist, q) < 0.34) continue;
        hits.push({
          id: row.videoId,
          title,
          artist,
          watchUrl: `https://www.youtube.com/watch?v=${row.videoId}`,
          durationSeconds:
            typeof row.lengthSeconds === 'number' && row.lengthSeconds > 0
              ? row.lengthSeconds
              : undefined,
        });
        if (hits.length >= limit) break;
      }
      if (hits.length > 0) {
        console.log('[InvidiousMobile] search ok via', root, hits.length);
        return hits;
      }
    } catch {
      /* try next instance */
    }
  }
  return [];
}

/** Piped first, then Invidious — whichever responds. */
export async function searchViaYoutubeWebMobile(
  query: string,
  limit = 8,
): Promise<PipedSearchHit[]> {
  const piped = await searchViaPipedMobile(query, limit);
  if (piped.length > 0) return piped;
  return searchViaInvidiousMobile(query, limit);
}

function extractYoutubeVideoId(watchUrl: string): string | null {
  const m = watchUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] ?? null;
}

/** Best-effort Piped audio stream URL for a YouTube watch page. */
export async function resolveViaPipedMobile(watchUrl: string): Promise<string | null> {
  const videoId = extractYoutubeVideoId(watchUrl.trim());
  if (!videoId) return null;

  for (const base of PIPED_BASES) {
    const endpoint = `${base.replace(/\/$/, '')}/streams/${videoId}`;
    try {
      const res = await fetch(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'SandboxMusic/1.0' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        audioStreams?: Array<{ url?: string; bitrate?: number }>;
      };
      const streams = (data.audioStreams ?? []).filter((s) =>
        /^https?:\/\//i.test(s?.url?.trim() ?? ''),
      );
      if (streams.length === 0) continue;
      streams.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const best = streams[0]?.url?.trim();
      if (best) {
        console.log('[PipedMobile] resolved stream via', base);
        return best;
      }
    } catch {
      /* try next instance */
    }
  }
  return null;
}
