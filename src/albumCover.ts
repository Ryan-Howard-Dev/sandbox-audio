/**
 * Multi-provider album cover lookup. Tries several public sources in order so a
 * missing match in one service can be covered by another.
 *
 * Core order (see albumCoverProviders.ts):
 *   MusicBrainz → Deezer → Discogs → AudioDB → Last.fm → iTunes (strict artist+album) →
 *   untitled.stream (URL scrape) → DatPiff → YouTube thumbnail
 *
 * Last.fm and Discogs use public page search/scrape first — no API keys required.
 * Optional Last.fm scrobble key or Discogs token are fallbacks only.
 */

import { raceTimeout } from './fetchWithTimeout';
import { isCatalogCdnUrl, sanitizeCoverArtUrl } from './displaySanitize';
import {
  runCoverProviders,
  type CoverLookupResult,
  type CoverArtSource,
} from './albumCoverProviders';
import type { LockerEntry } from './lockerStorage';
import { coverArtArchiveUrlForRelease } from './sandboxLayer2';

export type { CoverLookupResult, CoverArtSource };

const OVERALL_LOOKUP_TIMEOUT_MS = 75_000;

const MB_RELEASE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse MusicBrainz release id from locker creditsJson enrichment payload. */
export function musicbrainzReleaseIdFromCredits(creditsJson?: string): string | undefined {
  if (!creditsJson?.trim()) return undefined;
  try {
    const parsed = JSON.parse(creditsJson) as { musicbrainzReleaseId?: string };
    const id = parsed.musicbrainzReleaseId?.trim();
    return id && MB_RELEASE_ID_RE.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** True when stored art likely came from a title-only iTunes match for a different artist. */
export function shouldReconcileLockerCoverWithMusicBrainz(
  albumArt: string | undefined,
  releaseId: string,
): boolean {
  const id = releaseId.trim();
  if (!id) return false;
  const art = albumArt?.trim();
  if (!art) return true;
  if (isCatalogCdnUrl(art)) return true;
  const lower = art.toLowerCase();
  if (lower.includes(id.toLowerCase())) return false;
  if (lower.includes('coverartarchive.org') || lower.includes('/coverart/release/')) {
    return !lower.includes(id.slice(0, 8));
  }
  return true;
}

export async function findAlbumCover(
  album: string,
  artist: string,
  options?: { musicbrainzReleaseId?: string },
): Promise<CoverLookupResult | null> {
  return (
    (await raceTimeout(
      runCoverProviders(album, artist, undefined, options),
      OVERALL_LOOKUP_TIMEOUT_MS,
    )) ?? null
  );
}

/** Locker-aware cover lookup — prefers MusicBrainz release id from credits before catalog search. */
export async function findAlbumCoverForLockerGroup(
  albumName: string,
  artist: string,
  tracks: Pick<LockerEntry, 'creditsJson' | 'albumArt'>[],
): Promise<CoverLookupResult | null> {
  const releaseId = tracks
    .map((t) => musicbrainzReleaseIdFromCredits(t.creditsJson))
    .find(Boolean);
  if (releaseId) {
    const cover = await findAlbumCover(albumName, artist, { musicbrainzReleaseId: releaseId });
    if (cover?.url) return cover;
    const fallbackUrl = coverArtArchiveUrlForRelease(releaseId);
    if (fallbackUrl) return { url: fallbackUrl, source: 'musicbrainz' };
  }
  return findAlbumCover(albumName, artist);
}

function normalize(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Album row art from the album field or a matching track in the same search result. */
export function resolveAlbumRowArtwork<
  TAlbum extends { title: string; artist: string; artworkUrl?: string },
  TTrack extends { artist: string; album?: string; artworkUrl?: string },
>(album: TAlbum, tracks: TTrack[] = []): string | undefined {
  const direct = sanitizeCoverArtUrl(album.artworkUrl);
  if (direct) return direct;

  const albumKey = normalize(album.title);
  const artistKey = normalize(album.artist);
  for (const track of tracks) {
    const art = sanitizeCoverArtUrl(track.artworkUrl);
    if (!art) continue;
    const trackAlbum = normalize(track.album ?? '');
    if (
      trackAlbum &&
      (trackAlbum === albumKey || titlesMatch(track.album ?? '', album.title))
    ) {
      return art;
    }
    const trackArtist = normalize(track.artist);
    if (
      trackArtist === artistKey ||
      trackArtist.includes(artistKey) ||
      artistKey.includes(trackArtist)
    ) {
      return art;
    }
  }
  return undefined;
}
