/**
 * Resolve imported playlist title stubs to catalog tracks and acquire to Locker.
 */

import { acquireCatalogTracks } from './acquisitionPipeline';
import type { ImportedTrackStub } from './importPlatforms';
import { extractEmbeddedPerformerFromText } from './importTitleParse';
import {
  isMislabeledPlaylistStubArtist,
  isTitleFragmentArtistName,
  isUsableArtistName,
  resolveKnownStubArtistReassignment,
} from './lockerStorage';
import { canAcquireOnMobile } from './mobileAcquisition';
import type { DownloadTierPreference } from './downloadQueue';
import type { StoredPlaylist } from './playlistStorage';
import {
  fetchSearchCatalog,
  matchCatalogTrackForTitle,
  trackTitlesFuzzyMatch,
  type CatalogTrack,
} from './searchCatalog';
import { tier34HealthOk } from './tier34/client';
import { yieldToMain } from './yieldToMain';

export type ResolveImportStubsResult = {
  tracks: CatalogTrack[];
  unresolved: ImportedTrackStub[];
};

export type AcquireImportedPlaylistResult = ResolveImportStubsResult & {
  acquisition: Awaited<ReturnType<typeof acquireCatalogTracks>>;
};

function normalizeMatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stubArtistIsJunk(artist: string | undefined, title: string): boolean {
  const a = artist?.trim() ?? '';
  if (!a) return true;
  if (/^(unknown artist|local upload|ymusic|digital jockey)$/i.test(a)) return true;
  if (isTitleFragmentArtistName(a, { title, artist: a, albumName: title, albumArtist: a })) {
    return true;
  }
  if (isMislabeledPlaylistStubArtist(a, { title, artist: a, albumName: title, albumArtist: a })) {
    return true;
  }
  // Keep short stylized names (¥$) for search; only drop clear title-word junk
  if (a.length > 2 && !isUsableArtistName(a) && /^[A-Za-z\s]+$/.test(a)) {
    return true;
  }
  return false;
}

function titleConfidence(localTitle: string, catalogTitle: string): number {
  if (!trackTitlesFuzzyMatch(localTitle, catalogTitle)) return 0;
  const local = localTitle.trim().toLowerCase();
  const remote = catalogTitle.trim().toLowerCase();
  if (local === remote) return 1;
  const localWords = local.split(/\s+/).filter((w) => w.length > 1);
  const remoteWords = remote.split(/\s+/).filter((w) => w.length > 1);
  if (localWords.length === 0 || remoteWords.length === 0) return 0;
  const overlap = localWords.filter((w) => remoteWords.includes(w)).length;
  return overlap / Math.max(localWords.length, remoteWords.length);
}

/** Stubs that do not yet have a matching locker track on the playlist. */
export function unmatchedImportStubs(playlist: StoredPlaylist): ImportedTrackStub[] {
  const stubs = playlist.importTrackStubs ?? [];
  if (!stubs.length) return [];
  const matchedKeys = new Set(
    playlist.tracks.map((t) => `${normalizeMatchKey(t.title)}|${normalizeMatchKey(t.artist)}`),
  );
  return stubs.filter((stub) => {
    const key = `${normalizeMatchKey(stub.title)}|${normalizeMatchKey(stub.artist ?? '')}`;
    return !matchedKeys.has(key);
  });
}

/** Catalog search query for a single imported stub (artist + title, not playlist name). */
export function stubCatalogSearchQuery(stub: ImportedTrackStub): string {
  const title = stub.title.trim();
  const artist = stub.artist?.trim();
  if (artist && !stubArtistIsJunk(artist, title)) {
    return `${artist} ${title}`;
  }
  return title;
}

/** First unmatched stub search query, or playlist name when none remain. */
export function playlistTrackSearchQuery(playlist: StoredPlaylist): string {
  const next = unmatchedImportStubs(playlist)[0];
  return next ? stubCatalogSearchQuery(next) : playlist.name.trim();
}

/** Catalog track built from an import stub — used when search has no hit (mobile yt-dlp / server acquire). */
export function stubToCatalogTrack(stub: ImportedTrackStub, index: number): CatalogTrack {
  const title = stub.title.trim();
  let artist = stub.artist?.trim() || 'Unknown Artist';
  const stubContext = { title, artist, albumName: title, albumArtist: artist };

  const known = resolveKnownStubArtistReassignment(stubContext);
  if (known?.artist) {
    artist = known.artist;
  } else if (stubArtistIsJunk(artist, title)) {
    const parsed = extractEmbeddedPerformerFromText(title);
    if (
      parsed?.artist &&
      isUsableArtistName(parsed.artist) &&
      !stubArtistIsJunk(parsed.artist, parsed.title || title) &&
      /\s[-–—]\s/.test(title)
    ) {
      artist = parsed.artist;
    } else {
      artist = 'Unknown Artist';
    }
  }
  const slug = `${artist}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    kind: 'track',
    id: `import-stub-${slug}-${index}`,
    title,
    artist,
    durationSeconds: stub.duration,
  };
}

function pickBestStubMatch(
  stub: ImportedTrackStub,
  tracks: CatalogTrack[],
): CatalogTrack | undefined {
  if (!tracks.length) return undefined;
  const titleMatches = tracks.filter((t) => matchCatalogTrackForTitle(stub.title, [t]));
  if (!titleMatches.length) return undefined;

  let best: CatalogTrack | undefined;
  let bestConf = 0;
  for (const t of titleMatches) {
    const conf = titleConfidence(stub.title, t.title);
    if (conf > bestConf) {
      bestConf = conf;
      best = t;
    }
  }
  // Require strong title agreement — never assign wrong famous artists
  if (!best || bestConf < 0.88) return undefined;

  const artist = stub.artist?.trim();
  if (artist && !stubArtistIsJunk(artist, stub.title)) {
    const artistKey = normalizeName(artist);
    const withArtist = titleMatches.find((t) => {
      const conf = titleConfidence(stub.title, t.title);
      if (conf < 0.88) return false;
      const trackArtist = normalizeName(t.artist);
      return (
        trackArtist === artistKey ||
        trackArtist.includes(artistKey) ||
        artistKey.includes(trackArtist)
      );
    });
    return withArtist ?? (bestConf >= 0.95 ? best : undefined);
  }
  return best;
}

export async function resolveImportStubsToCatalogTracks(
  stubs: ImportedTrackStub[],
  onProgress?: (resolved: number, total: number) => void,
  options?: { skipCatalogSearch?: boolean },
): Promise<ResolveImportStubsResult> {
  const tracks: CatalogTrack[] = [];
  const unresolved: ImportedTrackStub[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < stubs.length; i++) {
    const stub = stubs[i]!;
    onProgress?.(i, stubs.length);
    await yieldToMain();

    let track: CatalogTrack | undefined;
    if (!options?.skipCatalogSearch) {
      try {
        const result = await fetchSearchCatalog(stubCatalogSearchQuery(stub));
        track = pickBestStubMatch(stub, result.tracks);
        if (!track && stubArtistIsJunk(stub.artist, stub.title)) {
          const titleOnly = await fetchSearchCatalog(stub.title.trim());
          track = pickBestStubMatch({ ...stub, artist: undefined }, titleOnly.tracks);
        }
      } catch {
        /* catalog optional — fall back to stub metadata */
      }
    }
    if (!track) {
      track = stubToCatalogTrack(stub, i);
    } else if (stubArtistIsJunk(track.artist, track.title)) {
      track = { ...track, artist: 'Unknown Artist' };
    }

    const dedupeKey = `${normalizeName(track.artist)}|${normalizeName(track.title)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    tracks.push(track);
  }

  onProgress?.(stubs.length, stubs.length);
  return { tracks, unresolved };
}

export async function acquireImportedPlaylist(
  playlist: StoredPlaylist,
  tier: DownloadTierPreference,
  jobId?: string,
  onResolveProgress?: (resolved: number, total: number) => void,
): Promise<AcquireImportedPlaylistResult> {
  const stubs = unmatchedImportStubs(playlist);
  if (!stubs.length) {
    return {
      tracks: [],
      unresolved: [],
      acquisition: { saved: 0, skipped: 0, failed: 0, errors: [] },
    };
  }

  const serverUp = await tier34HealthOk();
  const skipCatalogSearch = !serverUp && canAcquireOnMobile();
  const { tracks, unresolved } = await resolveImportStubsToCatalogTracks(
    stubs,
    onResolveProgress,
    { skipCatalogSearch },
  );

  if (!tracks.length) {
    return {
      tracks,
      unresolved: stubs,
      acquisition: { saved: 0, skipped: 0, failed: 0, errors: ['No tracks to download'] },
    };
  }

  const acquisition = await acquireCatalogTracks(tracks, tier, jobId, 'tracks');
  return { tracks, unresolved, acquisition };
}
