/**
 * Finding the record in the catalogue, by name rather than by barcode.
 *
 * barcodeRelease answers "what is this number". This answers "which of these is my album", which is
 * a different question with a different failure mode: a barcode is exact and a name is not, so this
 * returns several candidates and lets somebody look, rather than picking one and being confidently
 * wrong about a reissue.
 *
 * MusicBrainz needs no account and no key, and cover art comes from the Cover Art Archive by
 * release id, so nothing here needs a third party to be told what somebody owns. Only the search
 * terms go out, and only when a search is asked for.
 */

import type { CandidateTrack, ReleaseCandidate } from './metadataEdit';

const MB_USER_AGENT = 'SandboxMusic/1.0.0 (https://github.com/sandbox-music; release-lookup)';
const MB_BASE = 'https://musicbrainz.org';
const COVER_ART_BASE = 'https://coverartarchive.org';

export type ReleaseSearch =
  | { status: 'found'; candidates: ReleaseCandidate[] }
  /** The search ran and the catalogue has nothing like it. */
  | { status: 'none' }
  /** Nothing worth searching for was given. */
  | { status: 'empty' }
  /** No network, or the catalogue refused. Different from 'none': try again later. */
  | { status: 'unavailable' };

export interface ReleaseLookupDeps {
  fetchJson: (url: string, headers: Record<string, string>) => Promise<unknown>;
}

interface MbArtistCredit {
  name?: string;
}
interface MbTrack {
  title?: string;
  position?: number;
  length?: number;
  recording?: { title?: string; length?: number };
}
interface MbMedium {
  position?: number;
  format?: string;
  'track-count'?: number;
  tracks?: MbTrack[];
}
interface MbRelease {
  id?: string;
  title?: string;
  date?: string;
  'artist-credit'?: MbArtistCredit[];
  media?: MbMedium[];
  'track-count'?: number;
}

function creditedArtist(release: MbRelease): string {
  const credits = release['artist-credit'];
  if (!Array.isArray(credits) || credits.length === 0) return '';
  return credits
    .map((c) => (typeof c?.name === 'string' ? c.name : ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Year only, from whatever precision the catalogue has.
 *
 * Dates arrive as 1997, 1997-06 or 1997-06-16, and a locker row stores a year. Taking the first
 * four characters keeps all three working without parsing a date that may not be a full one.
 */
function yearOf(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

function tracksFrom(media: MbMedium[] | undefined): CandidateTrack[] {
  if (!Array.isArray(media)) return [];
  const tracks: CandidateTrack[] = [];
  for (const medium of media) {
    const discNumber = typeof medium?.position === 'number' ? medium.position : 1;
    for (const track of medium?.tracks ?? []) {
      // The release's track title wins over the recording's: a compilation may retitle a track,
      // and the sleeve is what somebody is looking at.
      const title = track?.title || track?.recording?.title || '';
      if (!title) continue;
      const lengthMs = track?.length ?? track?.recording?.length;
      tracks.push({
        title,
        trackNumber: typeof track?.position === 'number' ? track.position : tracks.length + 1,
        discNumber,
        durationSeconds:
          typeof lengthMs === 'number' && lengthMs > 0 ? Math.round(lengthMs / 1000) : undefined,
      });
    }
  }
  return tracks;
}

function totalTracks(release: MbRelease): number | undefined {
  if (typeof release['track-count'] === 'number') return release['track-count'];
  if (!Array.isArray(release.media)) return undefined;
  const summed = release.media.reduce((sum, m) => sum + (m?.['track-count'] ?? 0), 0);
  return summed > 0 ? summed : undefined;
}

/**
 * The front cover for a release, by convention rather than by lookup.
 *
 * The Cover Art Archive serves a predictable url per release id and 404s when there is none, so an
 * <img> that fails to load is the answer. Asking first would double every request for a picture
 * that is usually there.
 */
export function coverArtUrlForRelease(releaseId: string): string {
  return `${COVER_ART_BASE}/release/${encodeURIComponent(releaseId)}/front-500`;
}

function searchUrl(album: string, artist: string | undefined, limit: number): string {
  const terms = [`release:"${album.replace(/"/g, '')}"`];
  if (artist?.trim()) terms.push(`artist:"${artist.replace(/"/g, '')}"`);
  const query = encodeURIComponent(terms.join(' AND '));
  return `${MB_BASE}/ws/2/release?query=${query}&limit=${limit}&fmt=json`;
}

function releaseUrl(id: string): string {
  return `${MB_BASE}/ws/2/release/${encodeURIComponent(id)}?inc=recordings+artist-credits&fmt=json`;
}

async function defaultFetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Candidate releases for an album name.
 *
 * Two requests deep on purpose: search returns releases without their track lists, and the track
 * list is what tells an album from its reissue and what every row is matched against. Fetching
 * detail for the top few is the smallest thing that makes the result usable.
 */
export async function searchReleases(
  input: { album: string; artist?: string; limit?: number },
  deps: ReleaseLookupDeps = { fetchJson: defaultFetchJson },
): Promise<ReleaseSearch> {
  const album = input.album?.trim() ?? '';
  if (!album) return { status: 'empty' };
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));

  const headers = { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' };

  let found: MbRelease[];
  try {
    const raw = (await deps.fetchJson(searchUrl(album, input.artist, limit), headers)) as {
      releases?: MbRelease[];
    } | null;
    found = Array.isArray(raw?.releases) ? raw.releases : [];
  } catch {
    return { status: 'unavailable' };
  }

  if (found.length === 0) return { status: 'none' };

  const candidates: ReleaseCandidate[] = [];
  for (const summary of found) {
    if (!summary?.id) continue;
    let detail: MbRelease = summary;
    try {
      const raw = (await deps.fetchJson(releaseUrl(summary.id), headers)) as MbRelease | null;
      if (raw && typeof raw === 'object') detail = { ...summary, ...raw };
    } catch {
      /*
       * Keep the candidate without its track list rather than dropping it. A release that cannot
       * be fetched in detail is still worth showing — album, artist and year are all present from
       * the search, and every row will simply report as unmatched, which is honest.
       */
    }
    candidates.push({
      id: summary.id,
      title: detail.title ?? summary.title ?? album,
      artist: creditedArtist(detail) || creditedArtist(summary),
      year: yearOf(detail.date ?? summary.date),
      coverArtUrl: coverArtUrlForRelease(summary.id),
      media: detail.media?.[0]?.format ?? undefined,
      tracks: tracksFrom(detail.media),
      trackCount: totalTracks(detail) ?? totalTracks(summary),
    });
  }

  return candidates.length > 0 ? { status: 'found', candidates } : { status: 'none' };
}
