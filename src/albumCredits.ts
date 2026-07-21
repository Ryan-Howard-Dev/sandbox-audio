/**
 * Online album/track credits lookup (MusicBrainz + TheAudioDB).
 * Best-effort; never throws to callers.
 */

import { fetchAlbumMetadata } from './sandboxLayer2';
import {
  getLockerEntries,
  isUsableArtistName,
  refreshLockerCache,
  resolveAlbumSearchArtist,
  tracksForAlbumGroup,
  updateLockerEntryMetadata,
  type LockerEntry,
} from './lockerStorage';

const MB_USER_AGENT =
  'SandboxMusic/1.0.0 (https://github.com/sandbox-music; album-credits)';

const PLACEHOLDER_ARTIST =
  /^(local upload|unknown artist|sandbox artist|uploaded|local device locker|various artists?)$/i;

export interface TrackCreditsInfo {
  title: string;
  composer?: string;
  performers?: string[];
  producers?: string[];
  soloists?: string[];
}

export interface AlbumCreditsResult {
  composers: string[];
  performers: string[];
  producers: string[];
  engineers: string[];
  linerNotes?: string;
  linerNotesUrl?: string;
  bookletUrl?: string;
  tracks: TrackCreditsInfo[];
  source: 'musicbrainz' | 'audiodb' | 'mixed';
  musicbrainzReleaseId?: string;
  fetchedAt: number;
}

function mbBaseUrl(): string {
  if (typeof window !== 'undefined') return '/musicbrainz';
  return 'https://musicbrainz.org';
}

async function mbFetch(path: string): Promise<Response> {
  return fetch(`${mbBaseUrl()}${path}`, {
    headers: {
      'User-Agent': MB_USER_AGENT,
      Accept: 'application/json',
    },
  });
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

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function joinCredits(values: string[] | undefined): string | undefined {
  const u = uniqStrings(values ?? []);
  return u.length > 0 ? u.join(', ') : undefined;
}

function splitCredits(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
}

const PRODUCER_REL = /produc/i;
const ENGINEER_REL = /engineer|mix|master/i;
const COMPOSER_REL = /composer|writer|lyricist/i;
const SOLOIST_REL = /solo|vocals|instrument|performer|conductor/i;

type MbRelation = {
  type?: string;
  direction?: string;
  'target-type'?: string;
  artist?: { name?: string };
  url?: { resource?: string };
};

function relationArtistNames(relations: MbRelation[] | undefined, filter: RegExp): string[] {
  if (!relations?.length) return [];
  return uniqStrings(
    relations
      .filter((r) => r['target-type'] === 'artist' && filter.test(r.type ?? ''))
      .map((r) => r.artist?.name ?? '')
      .filter(Boolean),
  );
}

function urlRelations(
  relations: MbRelation[] | undefined,
  filter: RegExp,
): string | undefined {
  if (!relations?.length) return undefined;
  const hit = relations.find(
    (r) => r['target-type'] === 'url' && filter.test(r.type ?? '') && r.url?.resource,
  );
  return hit?.url?.resource;
}

async function fetchReleaseDetail(releaseId: string): Promise<{
  artistCredit: string[];
  relations: MbRelation[];
  recordings: Array<{ id: string; title: string; position: number }>;
} | null> {
  const res = await mbFetch(
    `/ws/2/release/${releaseId}?inc=artist-credits+recordings+artist-rels+labels&fmt=json`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
    relations?: MbRelation[];
    media?: Array<{
      tracks?: Array<{
        position?: number;
        title?: string;
        recording?: { id?: string; title?: string };
      }>;
    }>;
  };

  const artistCredit = uniqStrings(
    (data['artist-credit'] ?? []).map((ac) => ac.name ?? ac.artist?.name ?? ''),
  );

  const recordings: Array<{ id: string; title: string; position: number }> = [];
  for (const medium of data.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const id = track.recording?.id;
      const title = track.recording?.title ?? track.title ?? '';
      if (id && title) {
        recordings.push({ id, title, position: track.position ?? recordings.length + 1 });
      }
    }
  }

  return {
    artistCredit,
    relations: data.relations ?? [],
    recordings: recordings.sort((a, b) => a.position - b.position),
  };
}

async function fetchRecordingCredits(recordingId: string): Promise<{
  performers: string[];
  composers: string[];
  soloists: string[];
  producers: string[];
}> {
  const res = await mbFetch(
    `/ws/2/recording/${recordingId}?inc=artist-credits+artist-rels&fmt=json`,
  );
  if (!res.ok) {
    return { performers: [], composers: [], soloists: [], producers: [] };
  }
  const data = (await res.json()) as {
    'artist-credit'?: Array<{ name?: string }>;
    relations?: MbRelation[];
  };

  const performers = uniqStrings(
    (data['artist-credit'] ?? []).map((ac) => ac.name ?? ''),
  );
  const composers = relationArtistNames(data.relations, COMPOSER_REL);
  const soloists = relationArtistNames(data.relations, SOLOIST_REL);
  const producers = relationArtistNames(data.relations, PRODUCER_REL);

  return { performers, composers, soloists, producers };
}

interface AudioDbAlbum {
  strAlbum?: string;
  strDescriptionEN?: string;
  strDescription?: string;
}

async function fromAudioDbLinerNotes(
  album: string,
  artist: string,
): Promise<{ linerNotes?: string }> {
  if (!artist || PLACEHOLDER_ARTIST.test(artist)) return {};
  try {
    const res = await fetch(
      `https://www.theaudiodb.com/api/v1/json/2/searchalbum.php?s=${encodeURIComponent(
        artist,
      )}&a=${encodeURIComponent(album)}`,
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { album?: AudioDbAlbum[] | null };
    const match =
      data.album?.find((a) => a.strAlbum && titlesMatch(a.strAlbum, album)) ??
      data.album?.[0];
    const notes = match?.strDescriptionEN?.trim() || match?.strDescription?.trim();
    return notes ? { linerNotes: notes } : {};
  } catch {
    return {};
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch album and track credits from online sources.
 */
export async function fetchAlbumCredits(
  albumName: string,
  artist: string,
  localTracks?: Pick<LockerEntry, 'title' | 'artist' | 'albumArtist'>[],
): Promise<AlbumCreditsResult | null> {
  const album = (albumName ?? '').trim();
  if (!album) return null;

  const searchArtistRaw =
    artist && !PLACEHOLDER_ARTIST.test(artist)
      ? artist.trim()
      : resolveAlbumSearchArtist(album, artist, localTracks ?? []);
  const searchArtist = isUsableArtistName(searchArtistRaw) ? searchArtistRaw : '';

  const meta = await fetchAlbumMetadata(album, searchArtist);
  const releaseId = meta.musicbrainzReleaseId;
  if (!releaseId) {
    const audiodbOnly = await fromAudioDbLinerNotes(album, searchArtist);
    if (!audiodbOnly.linerNotes) return null;
    return {
      composers: [],
      performers: [],
      producers: [],
      engineers: [],
      linerNotes: audiodbOnly.linerNotes,
      tracks: (localTracks ?? []).map((t) => ({ title: t.title })),
      source: 'audiodb',
      fetchedAt: Date.now(),
    };
  }

  const detail = await fetchReleaseDetail(releaseId);
  if (!detail) return null;

  const albumPerformers = detail.artistCredit;
  const albumProducers = relationArtistNames(detail.relations, PRODUCER_REL);
  const albumEngineers = relationArtistNames(detail.relations, ENGINEER_REL);
  const bookletUrl =
    urlRelations(detail.relations, /discogs|allmusic|official|booklet|liner/i) ??
    undefined;

  const trackCredits: TrackCreditsInfo[] = [];
  const maxRecordingFetches = Math.min(detail.recordings.length, 25);

  for (let i = 0; i < maxRecordingFetches; i++) {
    const rec = detail.recordings[i];
    if (i > 0) await delay(110);
    const rc = await fetchRecordingCredits(rec.id);
    trackCredits.push({
      title: rec.title,
      composer: rc.composers.join(', ') || undefined,
      performers: rc.performers.length ? rc.performers : undefined,
      producers: rc.producers.length ? rc.producers : undefined,
      soloists: rc.soloists.length ? rc.soloists : undefined,
    });
  }

  const audiodb = await fromAudioDbLinerNotes(album, searchArtist || meta.artist);

  const composers = uniqStrings(
    trackCredits.flatMap((t) => splitCredits(t.composer)),
  );

  return {
    composers,
    performers: albumPerformers,
    producers: albumProducers,
    engineers: albumEngineers,
    linerNotes: audiodb.linerNotes,
    bookletUrl,
    tracks: trackCredits,
    source: audiodb.linerNotes ? 'mixed' : 'musicbrainz',
    musicbrainzReleaseId: releaseId,
    fetchedAt: Date.now(),
  };
}

function matchTrackCredits(
  localTitle: string,
  remoteTracks: TrackCreditsInfo[],
): TrackCreditsInfo | undefined {
  return remoteTracks.find((t) => titlesMatch(t.title, localTitle));
}

export interface PersistCreditsOptions {
  albumName: string;
  artist: string;
  tracks: LockerEntry[];
  credits: AlbumCreditsResult;
}

/** Persist fetched credits onto locker entries (album group + per-track). */
export async function persistAlbumCredits({
  albumName,
  artist,
  tracks,
  credits,
}: PersistCreditsOptions): Promise<void> {
  const creditsJson = JSON.stringify({
    source: credits.source,
    fetchedAt: credits.fetchedAt,
    musicbrainzReleaseId: credits.musicbrainzReleaseId,
    album: {
      composers: credits.composers,
      performers: credits.performers,
      producers: credits.producers,
      engineers: credits.engineers,
      linerNotes: credits.linerNotes,
      linerNotesUrl: credits.linerNotesUrl,
      bookletUrl: credits.bookletUrl,
    },
    tracks: credits.tracks,
  });

  const albumPatch = {
    performers: joinCredits(credits.performers),
    producers: joinCredits(credits.producers),
    engineers: joinCredits(credits.engineers),
    linerNotesUrl: credits.linerNotesUrl,
    bookletUrl: credits.bookletUrl,
    creditsJson,
    composer: joinCredits(credits.composers) ?? undefined,
  };

  await Promise.all(
    tracks.map(async (t) => {
      const matched = matchTrackCredits(t.title, credits.tracks);
      const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
        ...albumPatch,
      };
      if (matched?.composer && !t.composer?.trim()) {
        patch.composer = matched.composer;
      }
      if (matched?.performers?.length) {
        patch.trackPerformers = joinCredits(matched.performers);
      }
      if (matched?.producers?.length) {
        patch.trackProducers = joinCredits(matched.producers);
      }
      if (matched?.soloists?.length) {
        patch.trackSoloists = joinCredits(matched.soloists);
      }
      await updateLockerEntryMetadata(t.id, patch, { skipCacheRefresh: true });
    }),
  );

  await refreshLockerCache();
}

/** Fetch credits online and persist to the locker album group. */
export async function enrichAlbumMetadata(
  albumName: string,
  artist: string,
): Promise<AlbumCreditsResult | null> {
  const entries = await getLockerEntries();
  const tracks = tracksForAlbumGroup(entries, albumName, artist);
  if (tracks.length === 0) return null;

  const searchArtist = resolveAlbumSearchArtist(albumName, artist, tracks);
  const credits = await fetchAlbumCredits(
    albumName,
    searchArtist,
    tracks,
  );
  if (!credits) return null;

  await persistAlbumCredits({
    albumName,
    artist,
    tracks,
    credits,
  });

  return credits;
}

export function parseStoredCredits(entry: LockerEntry | undefined): {
  linerNotes?: string;
  linerNotesUrl?: string;
  bookletUrl?: string;
} | null {
  if (!entry?.creditsJson?.trim()) return null;
  try {
    const parsed = JSON.parse(entry.creditsJson) as {
      album?: {
        linerNotes?: string;
        linerNotesUrl?: string;
        bookletUrl?: string;
      };
    };
    return parsed.album ?? null;
  } catch {
    return null;
  }
}

export function isClassicalGenre(genre?: string): boolean {
  return /classical/i.test(genre ?? '');
}

export function formatCreditLine(values: string | undefined): string | undefined {
  const t = values?.trim();
  return t || undefined;
}

/** Guest / featured names from a persisted creditsJson snapshot (MusicBrainz vocal credits). */
export function artistCreditsFromLockerCreditsJson(
  tracks: Pick<LockerEntry, 'creditsJson'>[],
): string[] {
  const sample = tracks.find((t) => t.creditsJson?.trim());
  if (!sample?.creditsJson?.trim()) return [];
  try {
    const parsed = JSON.parse(sample.creditsJson) as { tracks?: TrackCreditsInfo[] };
    const names: string[] = [];
    for (const track of parsed.tracks ?? []) {
      if (track.performers?.length) names.push(...track.performers);
      if (track.soloists?.length) names.push(...track.soloists);
    }
    return uniqStrings(names);
  } catch {
    return [];
  }
}

/** Extract per-track performer + vocal credits from an online album credits payload. */
export function artistCreditsFromAlbumCreditsResult(credits: AlbumCreditsResult): string[] {
  const names: string[] = [];
  for (const track of credits.tracks) {
    if (track.performers?.length) names.push(...track.performers);
    if (track.soloists?.length) names.push(...track.soloists);
  }
  return uniqStrings(names);
}

/**
 * Best-effort online supplement when iTunes omits per-track feat. billing
 * (e.g. Kanye West — Donda).
 */
export async function fetchCatalogSupplementalArtistCredits(
  albumName: string,
  artist: string,
  localTracks?: Pick<LockerEntry, 'title' | 'artist' | 'albumArtist'>[],
): Promise<string[]> {
  const credits = await fetchAlbumCredits(albumName, artist, localTracks);
  if (!credits) return [];
  return artistCreditsFromAlbumCreditsResult(credits);
}
