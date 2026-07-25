/**
 * Locker genre shelves — group downloaded albums + singles by genre, the same
 * way the locker already groups by Artist and Playlist. Pure + deterministic so
 * it can be unit-tested and reused by the weekly-genre-playlist generator.
 */
import type { LockerEntry } from './lockerStorage';
import {
  filterCollectionsForLockerTab,
  type AlbumCollection,
} from './collectionIntelligence';
import { pickLockerAlbumCover } from './albumArtCache';
import { normalizeGenreBucket, type VinylGenreBucket } from './vinylGenreThemes';

export interface LockerGenreCover {
  url: string;
  /** Track the cover came from — used to re-resolve art from the vault. */
  trackId: string;
}

export interface LockerGenreShelf {
  /** Stable slug derived from the display label (`hip-hop`, `indie-rock`). */
  key: string;
  /** Human genre name shown on the shelf tile (`Hip-Hop`, `Jazz`). */
  label: string;
  /** Coarse bucket used only for vinyl/theme colours. */
  bucket: VinylGenreBucket;
  /** Albums + singles that fall under this genre. */
  collections: AlbumCollection[];
  albumCount: number;
  trackCount: number;
  /** Up to four distinct covers for a mosaic tile. */
  artworkUrls: string[];
  /** Same covers paired with a track id, so a dead `blob:` URL can be re-resolved. */
  covers: LockerGenreCover[];
  /** A few distinct artist names for the shelf subtitle. */
  topArtists: string[];
}

const UNKNOWN_GENRE_LABEL = 'Unknown';

/**
 * Canonicalise *spelling* variants only — never collapse distinct sub-genres.
 * Trap, Drill, Grime, Boom Bap and Nu Metal must stay their own shelves; folding
 * them into "Hip-Hop"/"Rock" is exactly what makes the Genres tab useless.
 */
const GENRE_ALIASES: Record<string, string> = {
  'hip hop': 'Hip-Hop',
  'hip-hop': 'Hip-Hop',
  hiphop: 'Hip-Hop',
  rap: 'Hip-Hop',
  'rap/hip hop': 'Hip-Hop',
  'hip hop/rap': 'Hip-Hop',
  rnb: 'R&B',
  'r&b': 'R&B',
  'r b': 'R&B',
  'rhythm and blues': 'R&B',
  electronica: 'Electronic',
  'drum and bass': 'Drum & Bass',
  'drum & bass': 'Drum & Bass',
  dnb: 'Drum & Bass',
  'd&b': 'Drum & Bass',
  'boom-bap': 'Boom Bap',
  boombap: 'Boom Bap',
  'nu-metal': 'Nu Metal',
  numetal: 'Nu Metal',
  'trip hop': 'Trip-Hop',
  triphop: 'Trip-Hop',
  'singer/songwriter': 'Singer-Songwriter',
  'singer-songwriter': 'Singer-Songwriter',
  'k-pop': 'K-Pop',
  kpop: 'K-Pop',
  'lo-fi': 'Lo-Fi',
  lofi: 'Lo-Fi',
  'g-funk': 'G-Funk',
  gfunk: 'G-Funk',
};

/** Tokens that should stay upper-case through title-casing. */
const GENRE_UPPERCASE_TOKENS = new Set([
  'uk',
  'us',
  'edm',
  'idm',
  'ukg',
  'dj',
  'rnb',
  'nyc',
  'la',
]);

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (GENRE_UPPERCASE_TOKENS.has(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Reduce a raw ID3 genre string to a single canonical display label.
 * Takes the first genre token when several are slash/comma-separated.
 */
export function normalizeGenreLabel(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return UNKNOWN_GENRE_LABEL;
  // ID3v1 numeric genres like "(17)" or bare numbers carry no meaning.
  if (/^\(?\d+\)?$/.test(trimmed)) return UNKNOWN_GENRE_LABEL;
  // "Downloaded" is a catalog-download sentinel (see lockerAlbumCompletion), not
  // a real genre — and "Music" / "Unknown" are non-informative catch-alls.
  if (/^(downloaded|music|unknown|other|genre)$/i.test(trimmed)) {
    return UNKNOWN_GENRE_LABEL;
  }

  const firstToken = trimmed
    .split(/[/,;|]| and /i)[0]
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!firstToken) return UNKNOWN_GENRE_LABEL;

  const lower = firstToken.toLowerCase();
  if (GENRE_ALIASES[lower]) return GENRE_ALIASES[lower];
  return titleCase(firstToken);
}

function slugifyGenre(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function collectionTracks(collection: AlbumCollection): LockerEntry[] {
  const seen = new Set<string>();
  const tracks: LockerEntry[] = [];
  for (const edition of collection.editions) {
    for (const track of edition.tracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
    }
  }
  return tracks;
}

/** Dominant genre for a collection = most common track genre (ties → first seen). */
export function dominantCollectionGenre(collection: AlbumCollection): string {
  const tally = new Map<string, number>();
  const order: string[] = [];
  for (const track of collectionTracks(collection)) {
    // Sub-genre wins so shelves stay specific (Trap, not Hip-Hop). Falls back to
    // the umbrella genre when no sub-genre is set.
    const label = normalizeGenreLabel(track.subGenre?.trim() || track.genre);
    if (label === UNKNOWN_GENRE_LABEL) continue;
    if (!tally.has(label)) order.push(label);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  if (order.length === 0) return UNKNOWN_GENRE_LABEL;
  let best = order[0];
  let bestCount = tally.get(best) ?? 0;
  for (const label of order) {
    const count = tally.get(label) ?? 0;
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Album-group cover for a collection. Uses the shared locker resolver so a
 * durable URL always beats a stale `blob:` object URL (those die when the app
 * process restarts, which otherwise leaves genre tiles with broken art).
 */
export function collectionCoverUrl(collection: AlbumCollection): string | undefined {
  return pickLockerAlbumCover(collectionTracks(collection));
}

/** All de-duplicated tracks under a collection. */
export function collectionTrackList(collection: AlbumCollection): LockerEntry[] {
  return collectionTracks(collection);
}

/**
 * Every non-video locker collection worth grouping by genre: album groups plus
 * orphan singles. Unions the 'artists' and 'singles' locker tabs and de-dupes by
 * collection key (single-track album groups appear in both).
 */
export function lockerGenreSourceCollections(
  collections: AlbumCollection[],
  entries: LockerEntry[],
): AlbumCollection[] {
  const albums = filterCollectionsForLockerTab(collections, 'artists', entries);
  const singles = filterCollectionsForLockerTab(collections, 'singles', entries);
  const byKey = new Map<string, AlbumCollection>();
  for (const collection of [...albums, ...singles]) {
    if (!byKey.has(collection.key)) byKey.set(collection.key, collection);
  }
  return [...byKey.values()];
}

/**
 * Group locker collections (albums + orphan singles, e.g. from
 * `lockerGenreSourceCollections`) into genre shelves.
 * `includeUnknown` keeps an "Unknown" catch-all shelf when true.
 */
export function buildLockerGenreShelves(
  collections: AlbumCollection[],
  options: { includeUnknown?: boolean; minTracks?: number } = {},
): LockerGenreShelf[] {
  const { includeUnknown = false, minTracks = 1 } = options;
  const byLabel = new Map<
    string,
    {
      label: string;
      collections: AlbumCollection[];
      covers: LockerGenreCover[];
      artists: Set<string>;
      trackCount: number;
    }
  >();

  for (const collection of collections) {
    const label = dominantCollectionGenre(collection);
    if (!includeUnknown && label === UNKNOWN_GENRE_LABEL) continue;
    let bucket = byLabel.get(label);
    if (!bucket) {
      bucket = { label, collections: [], covers: [], artists: new Set(), trackCount: 0 };
      byLabel.set(label, bucket);
    }
    bucket.collections.push(collection);
    bucket.trackCount += collectionTracks(collection).length;
    const cover = collectionCoverUrl(collection);
    if (cover && bucket.covers.length < 4 && !bucket.covers.some((c) => c.url === cover)) {
      const coverTrack =
        collectionTracks(collection).find((t) => t.albumArt?.trim() === cover) ??
        collectionTracks(collection)[0];
      if (coverTrack) bucket.covers.push({ url: cover, trackId: coverTrack.id });
    }
    const artist = collection.artist?.trim();
    if (artist) bucket.artists.add(artist);
  }

  const shelves: LockerGenreShelf[] = [];
  for (const bucket of byLabel.values()) {
    if (bucket.trackCount < minTracks) continue;
    shelves.push({
      key: slugifyGenre(bucket.label),
      label: bucket.label,
      bucket: normalizeGenreBucket(bucket.label),
      collections: bucket.collections
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      albumCount: bucket.collections.length,
      trackCount: bucket.trackCount,
      artworkUrls: bucket.covers.map((c) => c.url),
      covers: bucket.covers,
      topArtists: [...bucket.artists].slice(0, 3),
    });
  }

  // Biggest genres first; Unknown always sinks to the bottom.
  return shelves.sort((a, b) => {
    if (a.label === UNKNOWN_GENRE_LABEL) return 1;
    if (b.label === UNKNOWN_GENRE_LABEL) return -1;
    if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount;
    return a.label.localeCompare(b.label);
  });
}

/** All tracks under a genre shelf, de-duplicated, for play-all / playlist seeds. */
export function genreShelfTracks(shelf: LockerGenreShelf): LockerEntry[] {
  const seen = new Set<string>();
  const out: LockerEntry[] = [];
  for (const collection of shelf.collections) {
    for (const track of collectionTracks(collection)) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}
