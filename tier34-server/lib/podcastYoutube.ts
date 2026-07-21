import { spawn } from 'node:child_process';

type YtdlpInvocation = { cmd: string; prefixArgs: string[] };

function ytdlpInvocations(): YtdlpInvocation[] {
  const custom = process.env.YTDLP_PATH?.trim();
  if (custom) {
    if (custom.includes(' ')) {
      const parts = custom.split(/\s+/);
      return [{ cmd: parts[0], prefixArgs: parts.slice(1) }];
    }
    return [{ cmd: custom, prefixArgs: [] }];
  }
  return [
    { cmd: 'yt-dlp', prefixArgs: [] },
    { cmd: 'python', prefixArgs: ['-m', 'yt_dlp'] },
    { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
  ];
}

async function spawnYtdlpJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const args = [
    '--no-warnings',
    '--flat-playlist',
    '--playlist-end',
    '100',
    '-J',
    url,
  ];
  for (const inv of ytdlpInvocations()) {
    const result = await new Promise<{ stdout: string; ok: boolean }>((resolve) => {
      const procArgs = [...inv.prefixArgs, ...args];
      const proc = spawn(inv.cmd, procArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => {
        proc.kill();
        resolve({ stdout: '', ok: false });
      }, timeoutMs);
      proc.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve({ stdout: '', ok: false });
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout: out, ok: code === 0 });
      });
    });
    if (!result.ok || !result.stdout.trim()) continue;
    try {
      return JSON.parse(result.stdout) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function parseUploadDate(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return undefined;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const ms = Date.UTC(y, m, d);
  return Number.isFinite(ms) ? ms : undefined;
}

function pickThumbnail(data: Record<string, unknown>): string | undefined {
  const thumbs = data.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const sorted = [...thumbs].sort(
    (a, b) =>
      (typeof (b as { width?: number }).width === 'number' ? (b as { width: number }).width : 0) -
      (typeof (a as { width?: number }).width === 'number' ? (a as { width: number }).width : 0),
  );
  const url = (sorted[0] as { url?: string })?.url;
  return typeof url === 'string' && url.startsWith('http') ? url : undefined;
}

export function isYoutubePodcastListUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith('/playlist')) return true;
    if (path.startsWith('/channel/')) return true;
    if (path.startsWith('/@')) return true;
    if (path.startsWith('/c/') || path.startsWith('/user/')) return true;
    if (parsed.searchParams.has('list')) return true;
    return false;
  } catch {
    return false;
  }
}

export interface YoutubePodcastEpisodeRow {
  videoId: string;
  title: string;
  watchUrl: string;
  durationSeconds?: number;
  publishedAt?: number;
  artworkUrl?: string;
}

export interface YoutubePodcastFeedResult {
  title: string;
  description?: string;
  artworkUrl?: string;
  episodes: YoutubePodcastEpisodeRow[];
}

export async function fetchYoutubePodcastFeed(url: string): Promise<YoutubePodcastFeedResult> {
  const trimmed = url.trim();
  if (!isYoutubePodcastListUrl(trimmed)) {
    throw new Error('Not a YouTube channel or playlist URL');
  }

  const data = await spawnYtdlpJson(trimmed, 45_000);
  if (!data) {
    throw new Error('yt-dlp unavailable — install yt-dlp on the Tier 3/4 host (npm run dev:tier34)');
  }

  const title =
    (typeof data.title === 'string' && data.title.trim()) ||
    (typeof data.channel === 'string' && data.channel.trim()) ||
    (typeof data.uploader === 'string' && data.uploader.trim()) ||
    'YouTube Podcast';
  const description =
    typeof data.description === 'string' && data.description.trim()
      ? data.description.trim().slice(0, 500)
      : undefined;
  const artworkUrl = pickThumbnail(data);

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const episodes: YoutubePodcastEpisodeRow[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const videoId =
      (typeof row.id === 'string' && row.id.trim()) ||
      (typeof row.url === 'string' && row.url.match(/[?&]v=([^&]+)/)?.[1]) ||
      '';
    if (!videoId || videoId.length > 20) continue;
    const epTitle =
      (typeof row.title === 'string' && row.title.trim()) || 'Episode';
    const durationRaw = Number(row.duration);
    episodes.push({
      videoId,
      title: epTitle.slice(0, 200),
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      durationSeconds:
        Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : undefined,
      publishedAt: parseUploadDate(row.upload_date),
      artworkUrl: pickThumbnail(row) ?? artworkUrl,
    });
  }

  if (episodes.length === 0) {
    throw new Error('No videos found — check the channel/playlist URL and yt-dlp access');
  }

  episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  return { title, description, artworkUrl, episodes };
}
