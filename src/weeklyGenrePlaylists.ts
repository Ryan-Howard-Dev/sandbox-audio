/**
 * Fresh-every-week auto playlists built from the locker's genre shelves.
 * Deterministic per ISO week: the same week always yields the same track order
 * (so a playlist doesn't reshuffle mid-week), but a new week reseeds and rotates
 * to a different slice/order of the genre's tracks.
 */
import type { LockerEntry } from './lockerStorage';
import { genreShelfTracks, type LockerGenreShelf } from './lockerGenreShelf';
import type { VinylGenreBucket } from './vinylGenreThemes';

export interface WeeklyGenrePlaylist {
  /** Stable within a week; changes when the week rolls over. */
  id: string;
  genreKey: string;
  genreLabel: string;
  bucket: VinylGenreBucket;
  title: string;
  /** ISO year-week, e.g. `2026-W30`. */
  weekStamp: string;
  tracks: LockerEntry[];
  artworkUrls: string[];
  /**
   * Same covers paired with the track they came from, so a dead `blob:` URL can be re-resolved.
   * Locker entries inherit an album sibling's albumArt string, so when the art-heal path revokes
   * one entry's object URL every inheritor of that string renders as a broken image.
   */
  covers: WeeklyGenreCover[];
}

export interface WeeklyGenreCover {
  url: string;
  trackId: string;
}

/** ISO-8601 week stamp (`YYYY-Www`) — weeks start Monday, per the ISO calendar. */
export function isoWeekStamp(date: Date = new Date()): string {
  // Copy so we don't mutate the caller's date; work in UTC to avoid DST drift.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) seeded from a uint32. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates — pure, order depends only on the seed + input order. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface WeeklyGenrePlaylistOptions {
  weekStamp?: string;
  /** Minimum tracks a genre needs before it earns a weekly playlist. */
  minTracks?: number;
  /** Cap on tracks per weekly playlist. */
  maxTracks?: number;
  /** Cap on how many weekly playlists to generate (biggest genres win). */
  maxPlaylists?: number;
}

/**
 * Build this week's genre auto-playlists from locker genre shelves.
 * Shelves are expected pre-sorted biggest-first (as `buildLockerGenreShelves`
 * returns them); the largest `maxPlaylists` genres get a mix.
 */
export function buildWeeklyGenrePlaylists(
  shelves: LockerGenreShelf[],
  options: WeeklyGenrePlaylistOptions = {},
): WeeklyGenrePlaylist[] {
  const {
    weekStamp = isoWeekStamp(),
    minTracks = 8,
    maxTracks = 25,
    maxPlaylists = 8,
  } = options;

  const playlists: WeeklyGenrePlaylist[] = [];
  for (const shelf of shelves) {
    if (shelf.label === 'Unknown') continue;
    const pool = genreShelfTracks(shelf);
    if (pool.length < minTracks) continue;

    const seed = hashString(`${weekStamp}:${shelf.key}`);
    const shuffled = seededShuffle(pool, seed);
    const tracks = shuffled.slice(0, Math.min(maxTracks, shuffled.length));
    const artworkUrls: string[] = [];
    const covers: WeeklyGenreCover[] = [];
    /*
     * De-duplicate by ALBUM, not by URL. Every locker row mints its own object URL, so two tracks
     * from one album carry different `blob:` strings for the identical image — a URL-keyed check
     * let the same cover fill two tiles of the mosaic.
     */
    const seenAlbums = new Set<string>();
    for (const track of tracks) {
      if (covers.length >= 4) break;
      const art = track.albumArt?.trim();
      if (!art) continue;
      const albumKey = `${(track.albumArtist || track.artist || '').trim().toLowerCase()}::${(
        track.albumName || ''
      )
        .trim()
        .toLowerCase()}`;
      if (seenAlbums.has(albumKey)) continue;
      seenAlbums.add(albumKey);
      artworkUrls.push(art);
      covers.push({ url: art, trackId: track.id });
    }

    playlists.push({
      id: `weekly-genre:${shelf.key}:${weekStamp}`,
      genreKey: shelf.key,
      genreLabel: shelf.label,
      bucket: shelf.bucket,
      title: `${shelf.label} · This week`,
      weekStamp,
      tracks,
      artworkUrls,
      covers,
    });
    if (playlists.length >= maxPlaylists) break;
  }
  return playlists;
}
