import { isAirGapEnabled } from './airGapMode';
import { getTier34BaseUrl } from './tier34/client';

export interface PodcastChapter {
  title: string;
  startSeconds: number;
}

export interface PodcastChaptersDoc {
  chapters: PodcastChapter[];
}

function normalizeStartSeconds(raw: number, durationHint?: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (durationHint && durationHint > 0 && raw > durationHint * 4) {
    return raw / 1000;
  }
  if (raw > 86_400) return raw / 1000;
  return raw;
}

export function parsePodcastChaptersJson(
  json: unknown,
  durationHint?: number,
): PodcastChapter[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const list = Array.isArray(root.chapters)
    ? root.chapters
    : Array.isArray(root)
      ? root
      : [];
  const chapters: PodcastChapter[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const title =
      (typeof row.title === 'string' && row.title.trim()) ||
      (typeof row.toc === 'string' && row.toc.trim()) ||
      '';
    const startRaw =
      typeof row.startTime === 'number'
        ? row.startTime
        : typeof row.start === 'number'
          ? row.start
          : typeof row.start_time === 'number'
            ? row.start_time
            : null;
    if (!title || startRaw == null) continue;
    chapters.push({
      title: title.trim(),
      startSeconds: normalizeStartSeconds(startRaw, durationHint),
    });
  }
  return chapters.sort((a, b) => a.startSeconds - b.startSeconds);
}

async function fetchChaptersViaProxy(url: string): Promise<string | null> {
  const tier34 = getTier34BaseUrl()?.replace(/\/$/, '');
  const targets = [
    tier34 ? `${tier34}/api/podcast-feed?url=${encodeURIComponent(url)}` : null,
    `/api/podcast-feed?url=${encodeURIComponent(url)}`,
  ].filter(Boolean) as string[];
  for (const target of targets) {
    try {
      const res = await fetch(target);
      if (res.ok) return res.text();
    } catch {
      /* try next */
    }
  }
  try {
    const res = await fetch(url);
    if (res.ok) return res.text();
  } catch {
    /* CORS */
  }
  return null;
}

export async function fetchPodcastChapters(
  chaptersUrl: string,
  durationHint?: number,
): Promise<PodcastChapter[]> {
  const trimmed = chaptersUrl.trim();
  if (!trimmed || isAirGapEnabled()) return [];
  const body = await fetchChaptersViaProxy(trimmed);
  if (!body?.trim()) return [];
  try {
    return parsePodcastChaptersJson(JSON.parse(body), durationHint);
  } catch {
    return [];
  }
}

export function findActiveChapterIndex(
  chapters: PodcastChapter[],
  currentSeconds: number,
): number {
  if (!chapters.length) return -1;
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startSeconds <= currentSeconds + 0.25) idx = i;
    else break;
  }
  return idx;
}

export function getActiveChapter(
  chapters: PodcastChapter[],
  currentSeconds: number,
): PodcastChapter | null {
  const idx = findActiveChapterIndex(chapters, currentSeconds);
  return idx >= 0 ? chapters[idx] ?? null : null;
}

/** Seek target for the previous chapter (or episode start). */
export function seekSecondsForPreviousChapter(
  chapters: PodcastChapter[],
  currentSeconds: number,
): number {
  if (!chapters.length) return 0;
  const active = findActiveChapterIndex(chapters, currentSeconds);
  if (active <= 0) return 0;
  return chapters[active - 1]?.startSeconds ?? 0;
}

/** Seek target for the next chapter, or null if already on the last chapter. */
export function seekSecondsForNextChapter(
  chapters: PodcastChapter[],
  currentSeconds: number,
): number | null {
  if (!chapters.length) return null;
  const active = findActiveChapterIndex(chapters, currentSeconds);
  const next = chapters[active + 1];
  if (!next) return null;
  if (next.startSeconds <= currentSeconds + 1) {
    return chapters[active + 2]?.startSeconds ?? null;
  }
  return next.startSeconds;
}
