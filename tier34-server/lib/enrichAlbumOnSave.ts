/**
 * Sequential MusicBrainz + cover art enrichment for acquired tracks.
 */

import crypto from 'node:crypto';

const MB_USER_AGENT = 'SandboxTier34/1.0 (locker-enrich)';

export type TrackEnrichInput = {
  title: string;
  artist: string;
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  durationSeconds?: number;
};

export type EnrichedAlbumMetadata = {
  musicbrainzReleaseId: string;
  musicbrainzReleaseGroupId?: string;
  releaseYear?: string;
  coverArtUrl?: string;
  coverArtBytes?: Buffer;
  coverHash?: string;
  creditsJson?: string;
};

const PLACEHOLDER_ARTIST = /^(local upload|unknown artist|various artists?)$/i;

function normalize(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeLucene(value: string): string {
  return value.replace(/[\\"+&|!(){}[\]^~*?:/-]/g, '\\$&');
}

function parseReleaseYear(date?: string): number {
  if (!date) return 9999;
  const year = parseInt(date.split('-')[0] ?? '', 10);
  return Number.isFinite(year) ? year : 9999;
}

/** Prefer earliest original release when title+artist match multiple editions. */
function pickBestRelease(
  releases: Array<{ id: string; title: string; date?: string; 'release-group'?: { id?: string } }>,
  album: string,
): { id: string; title: string; date?: string; releaseGroupId?: string } {
  const titleMatches = releases.filter((r) => normalize(r.title).includes(normalize(album)));
  const pool = titleMatches.length > 0 ? titleMatches : releases;

  const sorted = [...pool].sort((a, b) => parseReleaseYear(a.date) - parseReleaseYear(b.date));
  const best = sorted[0] ?? releases[0];
  return {
    id: best.id,
    title: best.title,
    date: best.date,
    releaseGroupId: best['release-group']?.id,
  };
}

async function mbFetch(path: string): Promise<Response> {
  return fetch(`https://musicbrainz.org${path}`, {
    headers: {
      'User-Agent': MB_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });
}

async function searchRelease(
  query: string,
): Promise<Array<{ id: string; title: string; date?: string; 'release-group'?: { id?: string } }>> {
  const res = await mbFetch(
    `/ws/2/release?query=${encodeURIComponent(query)}&fmt=json&limit=8&inc=release-groups`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    releases?: Array<{ id: string; title: string; date?: string; 'release-group'?: { id?: string } }>;
  };
  return data.releases ?? [];
}

async function coverArtForRelease(releaseId: string): Promise<{ url: string; bytes?: Buffer; hash?: string } | null> {
  const caaUrl = `https://coverartarchive.org/release/${releaseId}`;
  try {
    const res = await fetch(`${caaUrl}`, {
      headers: { Accept: 'application/json', 'User-Agent': MB_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        images?: Array<{ front?: boolean; image?: string; thumbnails?: { large?: string } }>;
      };
      const front = data.images?.find((img) => img.front) ?? data.images?.[0];
      const imageUrl = front?.image ?? front?.thumbnails?.large;
      if (imageUrl) {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
        if (imgRes.ok) {
          const bytes = Buffer.from(await imgRes.arrayBuffer());
          const hash = crypto.createHash('sha256').update(bytes).digest('hex');
          return { url: imageUrl, bytes, hash };
        }
        return { url: imageUrl };
      }
    }
  } catch {
    /* fallback URL below */
  }
  const fallback = `${caaUrl}/front-500`;
  return { url: fallback };
}

type MbRelation = {
  type?: string;
  'target-type'?: string;
  artist?: { name?: string };
};

async function fetchReleaseCredits(releaseId: string): Promise<Record<string, unknown> | null> {
  const res = await mbFetch(
    `/ws/2/release/${releaseId}?inc=artist-credits+recordings+artist-rels+release-groups&fmt=json`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id: string;
    title?: string;
    date?: string;
    'release-group'?: { id?: string };
    'artist-credit'?: Array<{ name?: string }>;
    relations?: MbRelation[];
    media?: Array<{
      tracks?: Array<{ title?: string; recording?: { id?: string; title?: string } }>;
    }>;
  };

  const performers = (data['artist-credit'] ?? []).map((ac) => ac.name ?? '').filter(Boolean);
  const producers = (data.relations ?? [])
    .filter((r) => r['target-type'] === 'artist' && /produc/i.test(r.type ?? ''))
    .map((r) => r.artist?.name ?? '')
    .filter(Boolean);

  const tracks: Array<{ title: string; recordingId?: string }> = [];
  for (const medium of data.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const title = track.recording?.title ?? track.title ?? '';
      if (title) {
        tracks.push({ title, recordingId: track.recording?.id });
      }
    }
  }

  return {
    musicbrainzReleaseId: releaseId,
    musicbrainzReleaseGroupId: data['release-group']?.id,
    releaseTitle: data.title,
    releaseYear: data.date?.split('-')[0],
    performers,
    producers,
    tracks,
    fetchedAt: Date.now(),
    source: 'musicbrainz',
  };
}

/**
 * Resolve album metadata + credits in one sequential transaction.
 */
export async function enrichAlbumOnSave(trackData: TrackEnrichInput): Promise<EnrichedAlbumMetadata> {
  const album = (trackData.albumName ?? '').trim();
  const artist = (trackData.albumArtist ?? trackData.artist ?? '').trim();
  const empty: EnrichedAlbumMetadata = { musicbrainzReleaseId: '' };

  if (!album) return empty;

  const useArtist = artist.length > 0 && !PLACEHOLDER_ARTIST.test(artist);
  const queries: string[] = [];
  if (useArtist) {
    queries.push(`release:"${escapeLucene(album)}" AND artist:"${escapeLucene(artist)}"`);
    queries.push(`artist:"${escapeLucene(artist)}" AND release:"${escapeLucene(album)}"`);
  }
  queries.push(`release:"${escapeLucene(album)}"`);

  let releases: Array<{ id: string; title: string; date?: string; 'release-group'?: { id?: string } }> = [];
  for (const q of queries) {
    releases = await searchRelease(q);
    if (releases.length > 0) break;
    await new Promise((r) => setTimeout(r, 110));
  }

  if (releases.length === 0) return empty;

  const best = pickBestRelease(releases, album);
  const releaseYear = best.date?.split('-')[0] || trackData.releaseYear;

  const cover = await coverArtForRelease(best.id);
  const credits = await fetchReleaseCredits(best.id);

  return {
    musicbrainzReleaseId: best.id,
    musicbrainzReleaseGroupId: best.releaseGroupId ?? (credits?.musicbrainzReleaseGroupId as string | undefined),
    releaseYear,
    coverArtUrl: cover?.url,
    coverArtBytes: cover?.bytes,
    coverHash: cover?.hash,
    creditsJson: credits ? JSON.stringify(credits) : undefined,
  };
}
