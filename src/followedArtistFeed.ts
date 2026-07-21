/**
 * Compose factual followed-artist feed: catalog releases, locker additions,
 * MusicBrainz release announcements, and concert/tour dates. No news or gossip.
 */

import { isAirGapEnabled } from './airGapMode';
import type { MediaEnvelope } from './sandboxLayer1';
import { fetchWithTimeout } from './fetchWithTimeout';
import { scheduleMusicBrainz } from './musicbrainzScheduler';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import type { FollowedArtist } from './followedArtists';
import {
  CACHE_KEYS,
  prefixedCacheKey,
  readResponseCache,
  writeResponseCache,
} from './responseCache';
import { fetchSearchCatalog } from './searchCatalog';

export const RECENT_RELEASE_DAYS = 120;
const MB_USER_AGENT =
  'SandboxMusic/1.0.0 (https://github.com/sandbox-music; followed-feed)';

export type FollowedFeedRelease = {
  id: string;
  kind: 'release';
  title: string;
  artist: string;
  detail: string;
  artworkUrl?: string;
  envelope?: MediaEnvelope;
  sortKey: number;
};

export type FollowedFeedEvent = {
  id: string;
  kind: 'event';
  title: string;
  artist: string;
  detail: string;
  eventDate: string;
  sortKey: number;
};

export type FollowedFeedAnnouncement = {
  id: string;
  kind: 'announcement';
  title: string;
  artist: string;
  detail: string;
  releaseDate: string;
  sortKey: number;
};

export type FollowedArtistFeed = {
  releases: FollowedFeedRelease[];
  events: FollowedFeedEvent[];
  announcements: FollowedFeedAnnouncement[];
  fetchedAt: number;
  fromCache: boolean;
};

export type FollowedArtistFeedGroup = {
  artist: string;
  catalogArtistId?: string;
  releases: FollowedFeedRelease[];
  events: FollowedFeedEvent[];
  announcements: FollowedFeedAnnouncement[];
};

type CachedFeedPayload = {
  artistKeys: string;
  releases: FollowedFeedRelease[];
  events: FollowedFeedEvent[];
  announcements: FollowedFeedAnnouncement[];
};

type MbArtistSlice = {
  recent: FollowedFeedRelease[];
  announcements: FollowedFeedAnnouncement[];
  events: FollowedFeedEvent[];
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function artistKeys(artists: FollowedArtist[]): string {
  return artists
    .map((a) => `${normalizeKey(a.name)}|${a.musicbrainzArtistId ?? ''}`)
    .sort()
    .join(';');
}

function mbArtistCacheKey(artist: FollowedArtist): string {
  return prefixedCacheKey(
    CACHE_KEYS.MB_ARTIST_FEED,
    artist.musicbrainzArtistId ?? artist.name,
  );
}

function payloadToFeed(
  payload: CachedFeedPayload,
  fetchedAt: number,
  fromCache: boolean,
): FollowedArtistFeed {
  return {
    releases: payload.releases ?? [],
    events: payload.events ?? [],
    announcements: payload.announcements ?? [],
    fetchedAt,
    fromCache,
  };
}

/** Sync read of last saved followed-artist feed (stale OK). */
export function getFollowedArtistFeedCache(artists: FollowedArtist[]): FollowedArtistFeed | null {
  if (artists.length === 0) return null;
  const keyStr = artistKeys(artists);
  const hit = readResponseCache<CachedFeedPayload>(CACHE_KEYS.FOLLOWED_FEED);
  if (!hit || hit.data.artistKeys !== keyStr) return null;
  return payloadToFeed(hit.data, hit.fetchedAt, !hit.isFresh);
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value.length === 4 ? `${value}-06-15` : value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** True when a parsed release date falls inside the recent-release window. */
export function isRecentReleaseDate(
  parsed: Date | undefined,
  cutoff = daysAgo(RECENT_RELEASE_DAYS),
): boolean {
  if (!parsed) return false;
  return parsed >= cutoff;
}

/** Catalog stubs often ship with the artist name as the title — hide those. */
export function isStubFollowedReleaseTitle(title: string, artist: string): boolean {
  const t = normalizeKey(title);
  const a = normalizeKey(artist);
  if (!t || t.length < 2) return true;
  if (t === a) return true;
  return false;
}

function releaseYearToDate(year?: string): Date | undefined {
  const y = year?.trim();
  if (!y || !/^\d{4}$/.test(y)) return undefined;
  return parseIsoDate(`${y}-06-15`);
}

function formatCatalogReleaseDetail(track: {
  album?: string;
  releaseYear?: string;
}): string {
  const year = track.releaseYear?.trim();
  if (track.album) {
    return year ? `${track.album} · ${year}` : track.album;
  }
  return year ? `Single · ${year}` : 'From catalog';
}

function enrichReleaseEnvelope(
  track: { title: string; artist: string; artworkUrl?: string; envelope?: MediaEnvelope },
): MediaEnvelope | undefined {
  const env = track.envelope;
  if (!env?.url?.trim()) return undefined;
  const title = env.title?.trim() || track.title?.trim();
  const artist = env.artist?.trim() || track.artist?.trim();
  if (!title || isStubFollowedReleaseTitle(title, artist)) return undefined;
  const artworkUrl = track.artworkUrl ?? env.artworkUrl;
  return {
    ...env,
    title,
    artist,
    artworkUrl,
  };
}

function formatMonthYear(iso?: string): string {
  if (!iso) return '';
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatEventDate(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function artistNameMatches(trackArtist: string, followedName: string): boolean {
  const hay = normalizeKey(trackArtist);
  const needle = normalizeKey(followedName);
  if (hay === needle) return true;
  const first = needle.split(' ')[0];
  return first.length > 2 && hay.includes(first);
}

function mbBaseUrl(): string {
  if (typeof window !== 'undefined') return '/musicbrainz';
  return 'https://musicbrainz.org';
}

async function mbFetch(path: string): Promise<Response> {
  return scheduleMusicBrainz(() =>
    fetchWithTimeout(`${mbBaseUrl()}${path}`, {
      headers: {
        'User-Agent': MB_USER_AGENT,
        Accept: 'application/json',
      },
    }),
  );
}

async function fetchCatalogReleases(artist: FollowedArtist): Promise<FollowedFeedRelease[]> {
  if (isAirGapEnabled()) return [];
  const result = await fetchSearchCatalog(artist.name);
  const cutoff = daysAgo(RECENT_RELEASE_DAYS);
  const out: FollowedFeedRelease[] = [];
  const seen = new Set<string>();

  for (const track of result.tracks) {
    if (!artistNameMatches(track.artist, artist.name)) continue;
    if (isStubFollowedReleaseTitle(track.title, track.artist)) continue;

    const parsed = releaseYearToDate(track.releaseYear);
    if (!isRecentReleaseDate(parsed, cutoff)) continue;

    const envelope = enrichReleaseEnvelope(track);
    if (!envelope) continue;

    const key = normalizeKey(`${track.artist}::${track.title}`);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: `catalog-${track.id}`,
      kind: 'release',
      title: envelope.title,
      artist: envelope.artist,
      detail: formatCatalogReleaseDetail(track),
      artworkUrl: envelope.artworkUrl,
      envelope,
      sortKey: parsed!.getTime(),
    });
  }
  return out;
}

function fetchLockerReleases(artist: FollowedArtist): FollowedFeedRelease[] {
  const entries = getLockerEntriesSnapshot() ?? [];
  const cutoff = daysAgo(RECENT_RELEASE_DAYS).getTime();
  const out: FollowedFeedRelease[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const entryArtist = entry.albumArtist || entry.artist;
    if (!artistNameMatches(entryArtist, artist.name)) continue;
    if (entry.addedAt < cutoff) continue;
    const key = normalizeKey(`${entryArtist}::${entry.title}`);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: `locker-${entry.id}`,
      kind: 'release',
      title: entry.title,
      artist: entryArtist,
      detail: entry.albumName ? `${entry.albumName} · Your library` : 'Added to your library',
      artworkUrl: entry.albumArt,
      envelope: lockerEntryToEnvelope(entry),
      sortKey: entry.addedAt,
    });
  }
  return out;
}

interface MbReleaseGroup {
  id: string;
  title?: string;
  'primary-type'?: string;
  'first-release-date'?: string;
}

interface MbEvent {
  id: string;
  name?: string;
  type?: string;
  time?: { begin?: string };
  'place-relations'?: Array<{
    place?: { name?: string; area?: { name?: string } };
  }>;
}

async function fetchMbReleaseAnnouncementsUncached(
  artist: FollowedArtist,
): Promise<FollowedFeedAnnouncement[]> {
  const mbId = artist.musicbrainzArtistId;
  if (!mbId || isAirGapEnabled()) return [];

  const announcements: FollowedFeedAnnouncement[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const type of ['album', 'single'] as const) {
    try {
      const res = await mbFetch(
        `/ws/2/release-group?artist=${mbId}&type=${type}&fmt=json&limit=50`,
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { 'release-groups'?: MbReleaseGroup[] };
      for (const rg of data['release-groups'] ?? []) {
        if (!rg.id || !rg.title) continue;
        const dateStr = rg['first-release-date'];
        const date = parseIsoDate(dateStr);
        if (!date || date <= now) continue;

        const label = type === 'single' ? 'Single coming' : 'Album coming';
        announcements.push({
          id: `mb-announce-${rg.id}`,
          kind: 'announcement',
          title: rg.title,
          artist: artist.name,
          detail: `${label} · ${formatMonthYear(dateStr)}`,
          releaseDate: dateStr ?? '',
          sortKey: date.getTime(),
        });
      }
      await new Promise((r) => setTimeout(r, 1100));
    } catch {
      /* skip type */
    }
  }

  return announcements;
}

async function fetchMbRecentReleasesUncached(artist: FollowedArtist): Promise<FollowedFeedRelease[]> {
  const mbId = artist.musicbrainzArtistId;
  if (!mbId || isAirGapEnabled()) return [];

  const out: FollowedFeedRelease[] = [];
  const cutoff = daysAgo(RECENT_RELEASE_DAYS);
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  try {
    const res = await mbFetch(
      `/ws/2/release-group?artist=${mbId}&fmt=json&limit=40`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { 'release-groups'?: MbReleaseGroup[] };
    for (const rg of data['release-groups'] ?? []) {
      if (!rg.id || !rg.title) continue;
      const dateStr = rg['first-release-date'];
      const date = parseIsoDate(dateStr);
      if (!date || date > now || date < cutoff) continue;
      const typeLabel =
        rg['primary-type'] === 'Single'
          ? 'Single'
          : rg['primary-type'] === 'Album'
            ? 'Album'
            : 'Release';
      out.push({
        id: `mb-recent-${rg.id}`,
        kind: 'release',
        title: rg.title,
        artist: artist.name,
        detail: `${typeLabel} · ${formatMonthYear(dateStr)}`,
        sortKey: date.getTime(),
      });
    }
  } catch {
    return [];
  }
  return out;
}

async function fetchMbEventsUncached(artist: FollowedArtist): Promise<FollowedFeedEvent[]> {
  const mbId = artist.musicbrainzArtistId;
  if (!mbId || isAirGapEnabled()) return [];

  const out: FollowedFeedEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    const res = await mbFetch(
      `/ws/2/event?query=arid:${mbId}&fmt=json&limit=25`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: MbEvent[] };
    for (const ev of data.events ?? []) {
      if (!ev.id) continue;
      const begin = ev.time?.begin;
      if (!begin || begin < today) continue;

      const place = ev['place-relations']?.[0]?.place;
      const venue = place?.name;
      const area = place?.area?.name;
      const location = [venue, area].filter(Boolean).join(', ');
      const typeLabel =
        ev.type === 'Festival' ? 'Festival' : ev.type === 'Concert' ? 'Concert' : 'Show';

      out.push({
        id: `mb-event-${ev.id}`,
        kind: 'event',
        title: ev.name ?? typeLabel,
        artist: artist.name,
        detail: location
          ? `${typeLabel} · ${formatEventDate(begin)} · ${location}`
          : `${typeLabel} · ${formatEventDate(begin)}`,
        eventDate: begin,
        sortKey: parseIsoDate(begin)?.getTime() ?? Date.now(),
      });
    }
  } catch {
    return [];
  }
  return out;
}

async function fetchMbArtistSlice(artist: FollowedArtist): Promise<MbArtistSlice> {
  const cacheKey = mbArtistCacheKey(artist);
  const cached = readResponseCache<MbArtistSlice>(cacheKey);
  if (cached?.isFresh) return cached.data;

  const [recent, announcements, events] = await Promise.all([
    fetchMbRecentReleasesUncached(artist),
    fetchMbReleaseAnnouncementsUncached(artist),
    fetchMbEventsUncached(artist),
  ]);
  const slice: MbArtistSlice = { recent, announcements, events };
  writeResponseCache(cacheKey, slice);
  return slice;
}

function dedupeReleases(items: FollowedFeedRelease[]): FollowedFeedRelease[] {
  const seen = new Set<string>();
  const out: FollowedFeedRelease[] = [];
  for (const item of [...items].sort((a, b) => b.sortKey - a.sortKey)) {
    const key = normalizeKey(`${item.artist}::${item.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 24);
}

function dedupeEvents(items: FollowedFeedEvent[]): FollowedFeedEvent[] {
  const seen = new Set<string>();
  const out: FollowedFeedEvent[] = [];
  for (const item of [...items].sort((a, b) => a.sortKey - b.sortKey)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.slice(0, 16);
}

function dedupeAnnouncements(items: FollowedFeedAnnouncement[]): FollowedFeedAnnouncement[] {
  const seen = new Set<string>();
  const out: FollowedFeedAnnouncement[] = [];
  for (const item of [...items].sort((a, b) => a.sortKey - b.sortKey)) {
    const key = normalizeKey(`${item.artist}::${item.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 12);
}

function resolveArtistKey(artistName: string, followed: FollowedArtist[]): string {
  const needle = normalizeKey(artistName);
  const match = followed.find((a) => normalizeKey(a.name) === needle);
  return match ? normalizeKey(match.name) : needle;
}

/** Group flat followed feed into one block per followed artist (follow order). */
export function groupFollowedFeedByArtist(
  feed: FollowedArtistFeed | null,
  followedArtists: FollowedArtist[],
): FollowedArtistFeedGroup[] {
  if (!feed || followedArtists.length === 0) return [];

  const buckets = new Map<string, FollowedArtistFeedGroup>();
  for (const artist of followedArtists) {
    const key = normalizeKey(artist.name);
    buckets.set(key, {
      artist: artist.name,
      catalogArtistId: artist.catalogArtistId,
      releases: [],
      events: [],
      announcements: [],
    });
  }

  for (const release of feed.releases) {
    const key = resolveArtistKey(release.artist, followedArtists);
    const bucket = buckets.get(key);
    if (bucket) bucket.releases.push(release);
  }
  for (const event of feed.events) {
    const key = resolveArtistKey(event.artist, followedArtists);
    const bucket = buckets.get(key);
    if (bucket) bucket.events.push(event);
  }
  for (const announcement of feed.announcements) {
    const key = resolveArtistKey(announcement.artist, followedArtists);
    const bucket = buckets.get(key);
    if (bucket) bucket.announcements.push(announcement);
  }

  const sortByKey = <T extends { sortKey: number }>(items: T[], asc = false) =>
    [...items].sort((a, b) => (asc ? a.sortKey - b.sortKey : b.sortKey - a.sortKey));

  return followedArtists
    .map((artist) => buckets.get(normalizeKey(artist.name)))
    .filter((g): g is FollowedArtistFeedGroup => {
      if (!g) return false;
      return g.releases.length > 0 || g.events.length > 0 || g.announcements.length > 0;
    })
    .map((g) => ({
      ...g,
      releases: sortByKey(g.releases),
      events: sortByKey(g.events, true),
      announcements: sortByKey(g.announcements, true),
    }));
}

/** Build followed-artist feed; uses cache when offline or fetch fails. */
export async function fetchFollowedArtistFeed(
  artists: FollowedArtist[],
): Promise<FollowedArtistFeed> {
  const empty: FollowedArtistFeed = {
    releases: [],
    events: [],
    announcements: [],
    fetchedAt: Date.now(),
    fromCache: false,
  };
  if (artists.length === 0) return empty;

  const keyStr = artistKeys(artists);
  const cached = getFollowedArtistFeedCache(artists);

  if (isAirGapEnabled()) {
    return cached ?? empty;
  }

  try {
    const allReleases: FollowedFeedRelease[] = [];
    const allEvents: FollowedFeedEvent[] = [];
    const allAnnouncements: FollowedFeedAnnouncement[] = [];

    for (const artist of artists) {
      const [catalog, locker, mbSlice] = await Promise.all([
        fetchCatalogReleases(artist),
        Promise.resolve(fetchLockerReleases(artist)),
        fetchMbArtistSlice(artist),
      ]);

      allReleases.push(...catalog, ...locker, ...mbSlice.recent);
      allEvents.push(...mbSlice.events);
      allAnnouncements.push(...mbSlice.announcements);

      await new Promise((r) => setTimeout(r, 200));
    }

    const payload: CachedFeedPayload = {
      artistKeys: keyStr,
      releases: dedupeReleases(allReleases),
      events: dedupeEvents(allEvents),
      announcements: dedupeAnnouncements(allAnnouncements),
    };

    writeResponseCache(CACHE_KEYS.FOLLOWED_FEED, payload);
    return payloadToFeed(payload, Date.now(), false);
  } catch {
    return cached ?? empty;
  }
}
