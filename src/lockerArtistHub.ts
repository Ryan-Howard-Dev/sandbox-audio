import { parseStoredCredits } from './albumCredits';
import { trackTitlesFuzzyMatch } from './searchCatalog';
import { dedupeLockerEntriesForDisplay, type LockerEntry } from './lockerStorage';

export type LockerArtistTopTrackSource = 'catalog' | 'locker-only';

/** Minimal catalog chart row for matching locker tracks by popularity order. */
export type CatalogTopTrackRef = {
  title: string;
  artworkUrl?: string;
};

export type LockerArtistTopTrack = {
  entry: LockerEntry;
  source: LockerArtistTopTrackSource;
  /** Artwork from iTunes/catalog chart row when the locker track matched. */
  catalogArtworkUrl?: string;
};

export type LockerArtistCreditsSummary = {
  producers: string[];
  performers: string[];
  composers: string[];
  engineers: string[];
  featuredArtists: string[];
  albumCount: number;
};

const CAROUSEL_PREVIEW_COUNT = 4;
const TOP_TRACKS_PREVIEW_COUNT = 5;

function splitCreditNames(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[,;&/]|(?:\s+and\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function matchLockerEntryForCatalogTitle(
  title: string,
  pool: LockerEntry[],
  used: Set<string>,
): LockerEntry | undefined {
  return pool.find((entry) => !used.has(entry.id) && trackTitlesFuzzyMatch(entry.title, title));
}

/**
 * Top tracks for a locker artist — catalog/chart popularity order (iTunes lookup),
 * intersected with downloaded locker tracks. Unmatched locker tracks trail by date added.
 */
export function buildLockerArtistPopularTopTracks(
  entries: LockerEntry[],
  catalogTracks: CatalogTopTrackRef[] = [],
): LockerArtistTopTrack[] {
  const deduped = new Map<string, LockerEntry>();
  for (const entry of entries) {
    if (!deduped.has(entry.id)) deduped.set(entry.id, entry);
  }
  const pool = dedupeLockerEntriesForDisplay([...deduped.values()]);
  const used = new Set<string>();
  const rows: LockerArtistTopTrack[] = [];

  for (const catalog of catalogTracks) {
    const match = matchLockerEntryForCatalogTitle(catalog.title, pool, used);
    if (!match) continue;
    used.add(match.id);
    rows.push({
      entry: match,
      source: 'catalog',
      catalogArtworkUrl: catalog.artworkUrl,
    });
  }

  const remainder = pool
    .filter((entry) => !used.has(entry.id))
    .sort((a, b) => b.addedAt - a.addedAt);

  for (const entry of remainder) {
    rows.push({ entry, source: 'locker-only' });
  }

  return rows;
}

export function previewLockerArtistTopTracks(tracks: LockerArtistTopTrack[]): LockerArtistTopTrack[] {
  return tracks.slice(0, TOP_TRACKS_PREVIEW_COUNT);
}

export function previewLockerCarouselItems<T>(items: T[]): T[] {
  return items.slice(0, CAROUSEL_PREVIEW_COUNT);
}

export function lockerCarouselHasMore<T>(items: T[]): boolean {
  return items.length > CAROUSEL_PREVIEW_COUNT;
}

export function aggregateLockerArtistCredits(entries: LockerEntry[]): LockerArtistCreditsSummary {
  const producers: string[] = [];
  const performers: string[] = [];
  const composers: string[] = [];
  const engineers: string[] = [];
  const featuredArtists: string[] = [];
  const albums = new Set<string>();

  for (const entry of entries) {
    const albumKey = `${entry.albumName ?? ''}::${entry.albumArtist ?? entry.artist}`;
    if (albumKey.trim()) albums.add(albumKey);

    producers.push(...splitCreditNames(entry.producers));
    producers.push(...splitCreditNames(entry.trackProducers));
    performers.push(...splitCreditNames(entry.performers));
    performers.push(...splitCreditNames(entry.trackPerformers));
    composers.push(...splitCreditNames(entry.composer));
    engineers.push(...splitCreditNames(entry.engineers));
    featuredArtists.push(...splitCreditNames(entry.trackSoloists));

    const stored = parseStoredCredits(entry);
    if (stored?.linerNotes) {
      performers.push(...splitCreditNames(stored.linerNotes));
    }

    if (entry.creditsJson?.trim()) {
      try {
        const parsed = JSON.parse(entry.creditsJson) as {
          album?: {
            producers?: string[];
            performers?: string[];
            composers?: string[];
            engineers?: string[];
          };
        };
        const album = parsed.album;
        if (album) {
          producers.push(...(album.producers ?? []));
          performers.push(...(album.performers ?? []));
          composers.push(...(album.composers ?? []));
          engineers.push(...(album.engineers ?? []));
        }
      } catch {
        /* ignore malformed credits */
      }
    }
  }

  return {
    producers: uniqNames(producers),
    performers: uniqNames(performers),
    composers: uniqNames(composers),
    engineers: uniqNames(engineers),
    featuredArtists: uniqNames(featuredArtists),
    albumCount: albums.size,
  };
}

export function lockerArtistCreditsHasContent(summary: LockerArtistCreditsSummary): boolean {
  return (
    summary.producers.length > 0 ||
    summary.performers.length > 0 ||
    summary.composers.length > 0 ||
    summary.engineers.length > 0 ||
    summary.featuredArtists.length > 0
  );
}
