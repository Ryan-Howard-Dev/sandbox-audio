import type { ListeningSession, PlayEvent } from './playHistory';
import {
  COMPLETE_THRESHOLD_PCT,
  getAllListeningSessions,
  getAllPlayEvents,
  getAllPlaySessions,
} from './playHistory';
import type { PlaySession } from './playHistory';
import { isPodcastEnvelopeId } from './podcastStorage';
import { isAudiobookEnvelopeId } from './audiobookPlayback';
import { isAudiobookCatalogEnvelopeId } from './audiobookCatalogIds';
import { isNarrationEnvelopeId } from './narrationListenLog';

export type TimeRange = 'day' | 'week' | 'month' | 'year' | 'lifetime';

/** Listening format, classified from the envelope id (no schema/migration needed). */
export type MediaKind = 'music' | 'podcast' | 'audiobook' | 'spoken-text';

export function playEventKind(event: { envelopeId: string }): MediaKind {
  const id = event.envelopeId;
  // A book read aloud is listening too. Without this it fell through to 'music', which would put
  // a research paper among the year's top artists.
  if (isNarrationEnvelopeId(id)) return 'spoken-text';
  if (isPodcastEnvelopeId(id)) return 'podcast';
  if (isAudiobookEnvelopeId(id) || isAudiobookCatalogEnvelopeId(id)) return 'audiobook';
  return 'music';
}

function filterByKind(events: PlayEvent[], kind?: MediaKind): PlayEvent[] {
  if (!kind) return events;
  return events.filter((e) => playEventKind(e) === kind);
}

export type RankedItem = {
  key: string;
  label: string;
  subtitle?: string;
  minutes: number;
  plays: number;
  meaningfulPlays: number;
  avgCompletionPct: number;
  skips: number;
  repeats: number;
  score: number;
};

export type SessionStats = {
  sessionCount: number;
  totalSessionMinutes: number;
  avgSessionMinutes: number;
  longestSessionMinutes: number;
};

export type ListeningStats = {
  range: TimeRange;
  minutesListened: number;
  totalPlays: number;
  meaningfulPlays: number;
  sessionCount: number;
  skipCount: number;
  repeatCount: number;
  avgCompletionPct: number;
  sessionStats: SessionStats;
  topArtists: RankedItem[];
  topAlbums: RankedItem[];
  topTracks: RankedItem[];
};

/**
 * A year, summarised.
 *
 * The three top slots are named by tier rather than by what they hold, because what they hold
 * depends on the format. For music they are artist, album and track; for podcasts, show, series
 * and episode; for books, author, book and chapter. Naming the field topArtist and then putting
 * a podcast show in it was the version of this that read as a bug every time anyone looked.
 *
 * The caller supplies the words. ListeningStatsView already has them, in RANK_LABELS.
 */
export type WrappedSummary = {
  year: number;
  /** Which format this covers, or every format together. */
  kind: MediaKind | 'all';
  minutesListened: number;
  totalPlays: number;
  meaningfulPlays: number;
  sessionCount: number;
  skipCount: number;
  repeatCount: number;
  avgCompletionPct: number;
  topPrimary: RankedItem | null;
  topSecondary: RankedItem | null;
  topTertiary: RankedItem | null;
  topPrimaries: RankedItem[];
  topSecondaries: RankedItem[];
  topTertiaries: RankedItem[];
};

const MS_DAY = 86_400_000;
const REPEAT_SCORE_BONUS = 1.25;

function rangeStartMs(range: TimeRange, now = Date.now()): number | null {
  switch (range) {
    case 'day':
      return now - MS_DAY;
    case 'week':
      return now - 7 * MS_DAY;
    case 'month':
      return now - 30 * MS_DAY;
    case 'year':
      return now - 365 * MS_DAY;
    case 'lifetime':
      return null;
  }
}

function yearBounds(year: number): { start: number; end: number } {
  return {
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
  };
}

function filterByTimestamp<T extends { timestamp?: number; playedAt?: number }>(
  rows: T[],
  startMs: number | null,
  endMs: number | null = null,
): T[] {
  return rows.filter((row) => {
    const ts = row.timestamp ?? row.playedAt ?? 0;
    if (startMs != null && ts < startMs) return false;
    if (endMs != null && ts >= endMs) return false;
    return true;
  });
}

function filterListeningSessions(
  sessions: ListeningSession[],
  startMs: number | null,
  endMs: number | null = null,
): ListeningSession[] {
  return sessions.filter((s) => {
    if (startMs != null && s.endedAt < startMs) return false;
    if (endMs != null && s.startedAt >= endMs) return false;
    return true;
  });
}

function normalizeArtist(artist: string): string {
  const a = artist?.trim();
  return a || 'Unknown artist';
}

function normalizeAlbum(album: string | undefined): string {
  const alb = album?.trim();
  return alb || 'Unknown album';
}

/** Weight for rankings — skips contribute zero. */
export function meaningfulListenScore(event: PlayEvent): number {
  if (event.skipped) return 0;
  const completionWeight = event.completedPct / 100;
  const repeatBonus = event.repeat ? REPEAT_SCORE_BONUS : 1;
  return completionWeight * repeatBonus;
}

function playSessionToEvent(session: PlaySession): PlayEvent {
  const listenedMs =
    session.listenedMs ?? Math.max(0, Math.floor(session.listenedSeconds * 1000));
  const durationMs =
    session.durationMs ??
    (session.trackDurationSeconds != null && session.trackDurationSeconds > 0
      ? Math.round(session.trackDurationSeconds * 1000)
      : 0);
  return {
    trackId: session.trackId ?? session.envelopeId,
    envelopeId: session.envelopeId,
    artist: session.artist,
    album: session.album,
    title: session.title,
    durationMs,
    listenedMs,
    completedPct:
      session.completedPct ??
      (durationMs > 0
        ? Math.min(100, Math.round((listenedMs / durationMs) * 1000) / 10)
        : 0),
    skipped: session.skipped ?? false,
    repeat: session.repeat ?? false,
    timestamp: session.playedAt,
    sessionId: session.sessionId ?? 'legacy',
  };
}

function resolveEvents(events?: PlayEvent[]): PlayEvent[] {
  if (events) return events;
  const stored = getAllPlayEvents();
  if (stored.length > 0) return stored;
  return getAllPlaySessions().map(playSessionToEvent);
}

type AggRow = {
  label: string;
  subtitle?: string;
  listenedMs: number;
  plays: number;
  meaningfulPlays: number;
  completionSum: number;
  completionSamples: number;
  skips: number;
  repeats: number;
  score: number;
};

function rankEventsByKey(
  events: PlayEvent[],
  keyFn: (e: PlayEvent) => string,
  labelFn: (e: PlayEvent) => string,
  subtitleFn: (e: PlayEvent) => string | undefined,
  limit: number,
): RankedItem[] {
  const map = new Map<string, AggRow>();

  for (const e of events) {
    const key = keyFn(e);
    const weight = meaningfulListenScore(e);
    const cur = map.get(key);
    if (cur) {
      cur.listenedMs += e.listenedMs;
      cur.plays += 1;
      if (!e.skipped) {
        cur.meaningfulPlays += 1;
        cur.completionSum += e.completedPct;
        cur.completionSamples += 1;
      }
      if (e.skipped) cur.skips += 1;
      if (e.repeat) cur.repeats += 1;
      cur.score += weight;
    } else {
      map.set(key, {
        label: labelFn(e),
        subtitle: subtitleFn(e),
        listenedMs: e.listenedMs,
        plays: 1,
        meaningfulPlays: e.skipped ? 0 : 1,
        completionSum: e.skipped ? 0 : e.completedPct,
        completionSamples: e.skipped ? 0 : 1,
        skips: e.skipped ? 1 : 0,
        repeats: e.repeat ? 1 : 0,
        score: weight,
      });
    }
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      subtitle: v.subtitle,
      minutes: Math.round((v.listenedMs / 60_000) * 10) / 10,
      plays: v.plays,
      meaningfulPlays: v.meaningfulPlays,
      avgCompletionPct:
        v.completionSamples > 0
          ? Math.round((v.completionSum / v.completionSamples) * 10) / 10
          : 0,
      skips: v.skips,
      repeats: v.repeats,
      score: Math.round(v.score * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score || b.meaningfulPlays - a.meaningfulPlays)
    .slice(0, limit);
}

function buildSessionStats(
  listeningSessions: ListeningSession[],
): SessionStats {
  if (listeningSessions.length === 0) {
    return {
      sessionCount: 0,
      totalSessionMinutes: 0,
      avgSessionMinutes: 0,
      longestSessionMinutes: 0,
    };
  }
  const minutes = listeningSessions.map((s) => s.durationMs / 60_000);
  const total = minutes.reduce((sum, m) => sum + m, 0);
  const longest = Math.max(...minutes);
  return {
    sessionCount: listeningSessions.length,
    totalSessionMinutes: Math.round(total * 10) / 10,
    avgSessionMinutes: Math.round((total / listeningSessions.length) * 10) / 10,
    longestSessionMinutes: Math.round(longest * 10) / 10,
  };
}

function aggregateEvents(
  events: PlayEvent[],
  listeningSessions: ListeningSession[],
  range: TimeRange,
  topN = 8,
): ListeningStats {
  const totalListenedMs = events.reduce((sum, e) => sum + e.listenedMs, 0);
  const meaningful = events.filter((e) => !e.skipped);
  const completionSum = meaningful.reduce((sum, e) => sum + e.completedPct, 0);

  return {
    range,
    minutesListened: Math.round((totalListenedMs / 60_000) * 10) / 10,
    totalPlays: events.length,
    meaningfulPlays: meaningful.length,
    sessionCount: listeningSessions.length,
    skipCount: events.filter((e) => e.skipped).length,
    repeatCount: events.filter((e) => e.repeat).length,
    avgCompletionPct:
      meaningful.length > 0
        ? Math.round((completionSum / meaningful.length) * 10) / 10
        : 0,
    sessionStats: buildSessionStats(listeningSessions),
    topArtists: rankEventsByKey(
      events,
      (e) => normalizeArtist(e.artist),
      (e) => normalizeArtist(e.artist),
      () => undefined,
      topN,
    ),
    topAlbums: rankEventsByKey(
      events,
      (e) => `${normalizeAlbum(e.album)}::${normalizeArtist(e.artist)}`,
      (e) => normalizeAlbum(e.album),
      (e) => normalizeArtist(e.artist),
      topN,
    ),
    topTracks: rankEventsByKey(
      events,
      (e) => e.envelopeId,
      (e) => e.title?.trim() || 'Unknown track',
      (e) => normalizeArtist(e.artist),
      topN,
    ),
  };
}

export function getTopTracks(
  range: TimeRange,
  events = resolveEvents(),
  topN = 8,
): RankedItem[] {
  const start = rangeStartMs(range);
  const filtered = filterByTimestamp(events, start);
  return rankEventsByKey(
    filtered,
    (e) => e.envelopeId,
    (e) => e.title?.trim() || 'Unknown track',
    (e) => normalizeArtist(e.artist),
    topN,
  );
}

export function getTopAlbums(
  range: TimeRange,
  events = resolveEvents(),
  topN = 8,
): RankedItem[] {
  const start = rangeStartMs(range);
  const filtered = filterByTimestamp(events, start);
  return rankEventsByKey(
    filtered,
    (e) => `${normalizeAlbum(e.album)}::${normalizeArtist(e.artist)}`,
    (e) => normalizeAlbum(e.album),
    (e) => normalizeArtist(e.artist),
    topN,
  );
}

export function getTopArtists(
  range: TimeRange,
  events = resolveEvents(),
  topN = 8,
): RankedItem[] {
  const start = rangeStartMs(range);
  const filtered = filterByTimestamp(events, start);
  return rankEventsByKey(
    filtered,
    (e) => normalizeArtist(e.artist),
    (e) => normalizeArtist(e.artist),
    () => undefined,
    topN,
  );
}

export function getSessionStats(
  range: TimeRange,
  listeningSessions = getAllListeningSessions(),
): SessionStats {
  const start = rangeStartMs(range);
  const filtered = filterListeningSessions(listeningSessions, start);
  return buildSessionStats(filtered);
}

export function getListeningStats(
  range: TimeRange,
  events = resolveEvents(),
  topN = 8,
): ListeningStats {
  const start = rangeStartMs(range);
  const filtered = filterByTimestamp(events, start);
  const listeningSessions = filterListeningSessions(getAllListeningSessions(), start);
  return aggregateEvents(filtered, listeningSessions, range, topN);
}

/** Stats for a single format (music/podcast/audiobook) over a range. */
export function getFormatStats(
  range: TimeRange,
  kind?: MediaKind,
  topN = 8,
): ListeningStats {
  const start = rangeStartMs(range);
  const filtered = filterByKind(filterByTimestamp(resolveEvents(), start), kind);
  const listeningSessions = filterListeningSessions(getAllListeningSessions(), start);
  return aggregateEvents(filtered, listeningSessions, range, topN);
}

/** Per-format minutes for the Overview split (e.g. "6h music · 2h podcasts · 4h books"). */
export function getFormatMinutes(range: TimeRange): Record<MediaKind, number> {
  const start = rangeStartMs(range);
  const events = filterByTimestamp(resolveEvents(), start);
  const ms: Record<MediaKind, number> = {
    music: 0,
    podcast: 0,
    audiobook: 0,
    'spoken-text': 0,
  };
  for (const e of events) {
    ms[playEventKind(e)] += e.listenedMs;
  }
  const minutes = (value: number) => Math.round((value / 60_000) * 10) / 10;
  return {
    music: minutes(ms.music),
    podcast: minutes(ms.podcast),
    audiobook: minutes(ms.audiobook),
    'spoken-text': minutes(ms['spoken-text']),
  };
}

/**
 * A year of listening, for one format or all of them.
 *
 * Passing a kind is what makes this work for podcasts and books. Without it the summary is
 * every format pooled together, which for a mixed library means the top "artist" is whichever
 * podcast host talked the most, and the music year disappears behind it.
 */
export function getWrappedSummary(
  year: number,
  kind: MediaKind | 'all' = 'all',
  events = resolveEvents(),
  topN = 5,
): WrappedSummary {
  const { start, end } = yearBounds(year);
  const filtered = filterByKind(
    filterByTimestamp(events, start, end),
    kind === 'all' ? undefined : kind,
  );
  const listeningSessions = filterListeningSessions(getAllListeningSessions(), start, end);
  const stats = aggregateEvents(filtered, listeningSessions, 'lifetime', topN);
  return {
    year,
    kind,
    minutesListened: stats.minutesListened,
    totalPlays: stats.totalPlays,
    meaningfulPlays: stats.meaningfulPlays,
    sessionCount: stats.sessionCount,
    skipCount: stats.skipCount,
    repeatCount: stats.repeatCount,
    avgCompletionPct: stats.avgCompletionPct,
    topPrimary: stats.topArtists[0] ?? null,
    topSecondary: stats.topAlbums[0] ?? null,
    topTertiary: stats.topTracks[0] ?? null,
    topPrimaries: stats.topArtists,
    topSecondaries: stats.topAlbums,
    topTertiaries: stats.topTracks,
  };
}

/**
 * Years there is anything to show for.
 *
 * Filtered by kind so the year picker on the podcasts tab does not offer a year in which the
 * only thing played was music, which then renders an empty card.
 */
export function getAvailableWrappedYears(
  kind: MediaKind | 'all' = 'all',
  events = resolveEvents(),
): number[] {
  const years = new Set<number>();
  const now = new Date().getFullYear();
  years.add(now);
  for (const e of filterByKind(events, kind === 'all' ? undefined : kind)) {
    years.add(new Date(e.timestamp).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * What the three top slots are called, per format.
 *
 * Exported because two places need these words — the Insights screen and the shareable card —
 * and a second hand-kept copy is the one that ends up calling a podcast host an artist.
 */
export const WRAPPED_TIER_LABELS: Record<MediaKind | 'all', [string, string, string]> = {
  all: ['Top artist', 'Top album', 'Top track'],
  music: ['Top artist', 'Top album', 'Top track'],
  podcast: ['Top show', 'Top series', 'Top episode'],
  audiobook: ['Top author', 'Top book', 'Top chapter'],
  /*
   * Read aloud rather than performed, so nobody narrated it and calling anyone the top narrator
   * would be a fiction. The author is the author; the rest is the document and the passage.
   */
  'spoken-text': ['Top author', 'Top book', 'Top passage'],
};
export function formatMinutesHuman(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export function formatCompletionPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  return `${Math.round(pct)}%`;
}

export type ListeningReport = {
  exportedAt: string;
  privacy: 'local-only';
  range?: TimeRange;
  year?: number;
  stats: ListeningStats | WrappedSummary;
};

export function buildListeningReportJson(
  stats: ListeningStats | WrappedSummary,
  meta?: { range?: TimeRange; year?: number },
): string {
  const report: ListeningReport = {
    exportedAt: new Date().toISOString(),
    privacy: 'local-only',
    ...meta,
    stats,
  };
  return JSON.stringify(report, null, 2);
}

export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type WrappedCardColors = {
  bg: string;
  surface: string;
  accent: string;
  text: string;
  textMid: string;
};

const DEFAULT_CARD_COLORS: WrappedCardColors = {
  bg: '#07080c',
  surface: '#111420',
  accent: '#e8500a',
  text: '#e8e4df',
  textMid: '#9aa3bc',
};

function resolveAccentColor(): string {
  if (typeof document === 'undefined') return DEFAULT_CARD_COLORS.accent;
  const style = getComputedStyle(document.documentElement);
  const h = style.getPropertyValue('--accent-h').trim();
  const s = style.getPropertyValue('--accent-s').trim();
  const l = style.getPropertyValue('--accent-l').trim();
  if (h && s && l) return `hsl(${h}, ${s}, ${l})`;
  return DEFAULT_CARD_COLORS.accent;
}

export function renderWrappedCardToPng(
  summary: WrappedSummary,
  colors: Partial<WrappedCardColors> = {},
): Promise<Blob | null> {
  const c = { ...DEFAULT_CARD_COLORS, accent: resolveAccentColor(), ...colors };
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = c.surface;
  ctx.fillRect(48, 48, W - 96, H - 96);

  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  ctx.fillStyle = c.accent;
  ctx.font = '600 28px "IBM Plex Mono", monospace';
  ctx.fillText('LOCAL WRAPPED', 88, 120);

  ctx.fillStyle = c.text;
  ctx.font = '700 72px "Barlow Condensed", sans-serif';
  ctx.fillText(String(summary.year), 88, 210);

  ctx.fillStyle = c.textMid;
  ctx.font = '500 24px "IBM Plex Mono", monospace';
  ctx.fillText('PRIVACY-FIRST · DEVICE ONLY', 88, 252);

  const statY = 340;
  const statGap = 130;
  const drawStat = (label: string, value: string, y: number) => {
    ctx.fillStyle = c.textMid;
    ctx.font = '500 22px "IBM Plex Mono", monospace';
    ctx.fillText(label.toUpperCase(), 88, y);
    ctx.fillStyle = c.text;
    ctx.font = '700 48px "Barlow Condensed", sans-serif';
    ctx.fillText(value, 88, y + 52);
  };

  drawStat('Minutes listened', formatMinutesHuman(summary.minutesListened), statY);
  drawStat('Meaningful plays', String(summary.meaningfulPlays), statY + statGap);

  // Named for the format the card covers, so a podcast year does not claim a top artist.
  const [primaryLabel, secondaryLabel, tertiaryLabel] = WRAPPED_TIER_LABELS[summary.kind];
  const highlights: Array<[string, string]> = [
    [primaryLabel, summary.topPrimary?.label ?? '—'],
    [secondaryLabel, summary.topSecondary?.label ?? '—'],
    [tertiaryLabel, summary.topTertiary?.label ?? '—'],
  ];

  let hy = statY + statGap * 2 + 40;
  ctx.fillStyle = c.accent;
  ctx.font = '600 24px "IBM Plex Mono", monospace';
  ctx.fillText('HIGHLIGHTS', 88, hy);
  hy += 48;

  for (const [label, value] of highlights) {
    ctx.fillStyle = c.textMid;
    ctx.font = '500 20px "IBM Plex Mono", monospace';
    ctx.fillText(label.toUpperCase(), 88, hy);
    ctx.fillStyle = c.text;
    ctx.font = '600 32px "Barlow Condensed", sans-serif';
    const line = value.length > 42 ? `${value.slice(0, 39)}...` : value;
    ctx.fillText(line, 88, hy + 40);
    hy += 100;
  }

  ctx.fillStyle = c.textMid;
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  ctx.fillText(
    `Avg completion ${formatCompletionPct(summary.avgCompletionPct)} · Generated on device`,
    88,
    H - 88,
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function downloadWrappedCardPng(summary: WrappedSummary, filename?: string): Promise<void> {
  const blob = await renderWrappedCardToPng(summary);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `local-wrapped-${summary.year}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

// Re-export threshold for UI copy
export { COMPLETE_THRESHOLD_PCT };
