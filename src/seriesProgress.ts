/**
 * How far through a show or a book you actually are.
 *
 * This is the thing Trakt is genuinely good at and a play count cannot express. "You have listened
 * to In Our Time 340 times" says nothing useful. "You are eleven episodes behind" is the sentence
 * someone acts on, and "you stopped Jane Eyre four months ago at chapter three" is the one that
 * makes them either finish it or admit they will not.
 *
 * Deliberately pure, and deliberately not reading the library itself. Event history alone cannot
 * know how many episodes a show has published — only how many were played — so the totals are
 * passed in by the caller, which does know. That split is also what makes this testable without a
 * database.
 *
 * Music is absent on purpose. An album is not a series: there is no "behind on Nick Cave", and
 * completion of a record is not a thing anyone is trying to achieve.
 */

import { COMPLETE_THRESHOLD_PCT } from './playHistory';
import type { PlayEvent } from './playHistory';
import { playEventKind, type MediaKind } from './listeningAnalytics';

/** Series only. Podcast shows and audiobooks have episodes and chapters; albums do not. */
export type SeriesKind = Extract<MediaKind, 'podcast' | 'audiobook'>;

/**
 * What the caller knows and the event log does not: how much of this series exists.
 *
 * `totalItems` of zero means unknown rather than empty — a feed that failed to refresh should not
 * report every show as finished.
 */
export interface SeriesCatalogEntry {
  key: string;
  kind: SeriesKind;
  title: string;
  creator?: string;
  totalItems: number;
  /** When the newest item appeared, so "behind" can mean something newer exists. */
  latestItemAt?: number;
}

export type SeriesStatus =
  /** Everything available has been heard. */
  | 'finished'
  /** Keeping up: heard what is out, or all but the very newest. */
  | 'up-to-date'
  /** Still listening, but items have piled up. */
  | 'behind'
  /** Started, then nothing for a while. Not finished, not obviously given up on. */
  | 'stalled'
  /** Started long ago, barely progressed, silent since. */
  | 'abandoned';

export interface SeriesProgress {
  key: string;
  kind: SeriesKind;
  title: string;
  creator?: string;
  totalItems: number;
  /** Distinct items with any meaningful listening. */
  startedItems: number;
  /** Distinct items listened past the completion threshold. */
  completedItems: number;
  /** 0..100 against the catalogue total, or 0 when the total is unknown. */
  completionPct: number;
  lastPlayedAt: number;
  /** Items available but never started. */
  remaining: number;
  status: SeriesStatus;
}

/**
 * Quiet for this long and a series is no longer "in progress".
 *
 * A month is chosen against how podcasts are actually consumed: weekly shows tolerate a fortnight
 * off without anything being wrong, and a listener who has not returned in four weeks has stopped
 * rather than paused. Set lower, every holiday marks half a library as stalled.
 */
export const STALLED_AFTER_DAYS = 30;

/** Three months and barely begun is not a pause. Saying so is the point of the shelf. */
export const ABANDONED_AFTER_DAYS = 90;

/** Below this, a series was sampled rather than taken up. */
export const ABANDONED_BELOW_PCT = 20;

/**
 * One item behind is not behind.
 *
 * A weekly show drops an episode and for a few days everyone is "one behind", which is a useless
 * thing to be told. Two is where a backlog starts to be real.
 */
export const BEHIND_THRESHOLD_ITEMS = 2;

const MS_DAY = 86_400_000;

/**
 * The series an event belongs to.
 *
 * Podcasts group by show, which the event carries as its artist. Audiobooks group by the book,
 * carried as the album, because chapters of one book are the items of one series and the author is
 * not — someone reading two Brontë novels is on two series, not one.
 */
export function seriesKeyOf(event: PlayEvent): { key: string; kind: SeriesKind } | null {
  const kind = playEventKind(event);
  if (kind === 'podcast') {
    const show = (event.artist ?? '').trim();
    return show ? { key: `podcast:${show.toLowerCase()}`, kind: 'podcast' } : null;
  }
  if (kind === 'audiobook') {
    const book = (event.album ?? '').trim() || (event.title ?? '').trim();
    return book ? { key: `audiobook:${book.toLowerCase()}`, kind: 'audiobook' } : null;
  }
  return null;
}

/**
 * Decide where a series stands.
 *
 * Order matters. Finished is checked first because a completed series that has been quiet for a
 * year is finished, not abandoned, and telling someone they gave up on a book they completed is
 * the single most annoying thing this could do.
 */
export function resolveStatus(input: {
  totalItems: number;
  completedItems: number;
  completionPct: number;
  lastPlayedAt: number;
  now: number;
}): SeriesStatus {
  const { totalItems, completedItems, completionPct, lastPlayedAt, now } = input;
  const idleDays = (now - lastPlayedAt) / MS_DAY;

  if (totalItems > 0 && completedItems >= totalItems) return 'finished';

  if (idleDays >= ABANDONED_AFTER_DAYS && completionPct < ABANDONED_BELOW_PCT) return 'abandoned';
  if (idleDays >= STALLED_AFTER_DAYS) return 'stalled';

  // Still active. The only question left is whether a backlog has built up.
  const outstanding = totalItems > 0 ? totalItems - completedItems : 0;
  return outstanding >= BEHIND_THRESHOLD_ITEMS ? 'behind' : 'up-to-date';
}

/**
 * Progress for every series the events touch.
 *
 * A series with events but no catalogue entry is still reported, with a total of zero. Dropping it
 * would hide exactly the case worth seeing: a show unsubscribed from, or a feed that has stopped
 * resolving, that someone was halfway through.
 */
export function buildSeriesProgress(
  events: PlayEvent[],
  catalog: SeriesCatalogEntry[] = [],
  now = Date.now(),
): SeriesProgress[] {
  const byKey = new Map<string, SeriesCatalogEntry>();
  for (const entry of catalog) byKey.set(entry.key, entry);

  interface Accumulator {
    kind: SeriesKind;
    title: string;
    creator?: string;
    started: Set<string>;
    completed: Set<string>;
    lastPlayedAt: number;
  }
  const groups = new Map<string, Accumulator>();

  for (const event of events) {
    const series = seriesKeyOf(event);
    if (!series) continue;
    // A listen too short to count is not a start. Without this, a single mis-tap marks a
    // twelve-hour audiobook as begun and it sits on the shelf reproaching you forever.
    const meaningful = (event.completedPct ?? 0) > 0 && !event.skipped;
    if (!meaningful) continue;

    const existing = groups.get(series.key);
    const accumulator: Accumulator = existing ?? {
      kind: series.kind,
      title:
        byKey.get(series.key)?.title ??
        (series.kind === 'podcast' ? event.artist : event.album) ??
        event.title,
      creator: series.kind === 'audiobook' ? event.artist : undefined,
      started: new Set<string>(),
      completed: new Set<string>(),
      lastPlayedAt: 0,
    };
    accumulator.started.add(event.envelopeId);
    if ((event.completedPct ?? 0) >= COMPLETE_THRESHOLD_PCT) {
      accumulator.completed.add(event.envelopeId);
    }
    accumulator.lastPlayedAt = Math.max(accumulator.lastPlayedAt, event.timestamp);
    groups.set(series.key, accumulator);
  }

  const progress: SeriesProgress[] = [];
  for (const [key, accumulator] of groups) {
    const entry = byKey.get(key);
    const totalItems = entry?.totalItems ?? 0;
    const completedItems = accumulator.completed.size;
    const completionPct =
      totalItems > 0 ? Math.round((completedItems / totalItems) * 1000) / 10 : 0;

    progress.push({
      key,
      kind: accumulator.kind,
      title: entry?.title ?? accumulator.title,
      creator: entry?.creator ?? accumulator.creator,
      totalItems,
      startedItems: accumulator.started.size,
      completedItems,
      completionPct,
      lastPlayedAt: accumulator.lastPlayedAt,
      remaining: totalItems > 0 ? Math.max(0, totalItems - accumulator.started.size) : 0,
      status: resolveStatus({
        totalItems,
        completedItems,
        completionPct,
        lastPlayedAt: accumulator.lastPlayedAt,
        now,
      }),
    });
  }

  // Most recently touched first. A progress shelf is read top-down looking for what to resume,
  // and that is almost always the thing last listened to.
  return progress.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/**
 * The order these are worth showing in.
 *
 * Behind first because it is the only one with an obvious action attached. Finished last because
 * it is a record rather than a prompt.
 */
const STATUS_ORDER: SeriesStatus[] = ['behind', 'up-to-date', 'stalled', 'abandoned', 'finished'];

export function groupSeriesByStatus(
  progress: SeriesProgress[],
): Array<{ status: SeriesStatus; series: SeriesProgress[] }> {
  return STATUS_ORDER.map((status) => ({
    status,
    series: progress.filter((entry) => entry.status === status),
  })).filter((group) => group.series.length > 0);
}

/** Series worth resuming, newest first. What a "continue listening" row should show. */
export function resumableSeries(progress: SeriesProgress[], limit = 8): SeriesProgress[] {
  return progress
    .filter((entry) => entry.status === 'behind' || entry.status === 'up-to-date' || entry.status === 'stalled')
    .slice(0, limit);
}
