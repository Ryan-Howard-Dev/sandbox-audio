/**
 * Album blurbs and artist bios for device-scanned music.
 *
 * Same problem as audiobooks: file tags carry a title and an artist, never prose. This resolves
 * an MBID from MusicBrainz, follows its Wikipedia (or Wikidata → Wikipedia) relation, and
 * returns the lead extract.
 *
 * MusicBrainz and Wikipedia are both open, keyless, and already the kind of source this app
 * leans on. Every network call goes through `fetchWithTimeout`, which routes via native HTTP on
 * device (the WebView blocks these cross-origin) and enforces the air-gap block centrally.
 */

import { fetchWithTimeout } from './fetchWithTimeout';

export type MusicDescriptionKind = 'album' | 'artist';

const CACHE_KEY = 'sandbox_music_descriptions_v1';
const LOOKUP_TIMEOUT_MS = 8000;
/** Cache misses too, so an obscure release is not re-queried on every open. */
const MISS = '';

type DescriptionCache = Record<string, string>;

export function musicDescriptionKey(
  kind: MusicDescriptionKind,
  name: string,
  artist: string,
): string {
  return `${kind}:${name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
}

function readCache(): DescriptionCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DescriptionCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getCachedMusicDescription(
  kind: MusicDescriptionKind,
  name: string,
  artist: string,
): string | null {
  const hit = readCache()[musicDescriptionKey(kind, name, artist)];
  return hit === undefined ? null : hit;
}

export function cacheMusicDescription(
  kind: MusicDescriptionKind,
  name: string,
  artist: string,
  description: string,
): void {
  const cache = readCache();
  cache[musicDescriptionKey(kind, name, artist)] = description;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — a missing blurb is not worth failing over */
  }
}

/** Strip the rip/edition noise that file tags carry but MusicBrainz does not. */
export function normalizeMusicQuery(value: string): string {
  return value
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s*[\(\[](deluxe|expanded|remaster(ed)?|explicit|bonus)[^)\]]*[\)\]]/gi, '')
    .replace(/\b(deluxe|remastered|explicit)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMusicBrainzSearchUrl(
  kind: MusicDescriptionKind,
  name: string,
  artist: string,
): string {
  const entity = kind === 'album' ? 'release-group' : 'artist';
  const cleanName = normalizeMusicQuery(name);
  const cleanArtist = normalizeMusicQuery(artist);
  const query =
    kind === 'album' && cleanArtist
      ? `releasegroup:"${cleanName}" AND artist:"${cleanArtist}"`
      : kind === 'album'
        ? `releasegroup:"${cleanName}"`
        : `artist:"${cleanName}"`;
  return `https://musicbrainz.org/ws/2/${entity}?query=${encodeURIComponent(
    query,
  )}&limit=1&fmt=json`;
}

export function parseMusicBrainzMbid(
  kind: MusicDescriptionKind,
  payload: unknown,
): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const listKey = kind === 'album' ? 'release-groups' : 'artists';
  const list = (payload as Record<string, unknown>)[listKey];
  if (!Array.isArray(list) || list.length === 0) return null;
  const id = (list[0] as { id?: unknown })?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export function buildMusicBrainzRelationsUrl(
  kind: MusicDescriptionKind,
  mbid: string,
): string {
  const entity = kind === 'album' ? 'release-group' : 'artist';
  return `https://musicbrainz.org/ws/2/${entity}/${mbid}?inc=url-rels&fmt=json`;
}

type RelationTargets = { wikipediaTitle: string | null; wikidataId: string | null };

/** MusicBrainz links either straight to Wikipedia or (more often now) to Wikidata. */
export function parseMusicBrainzRelations(payload: unknown): RelationTargets {
  const empty: RelationTargets = { wikipediaTitle: null, wikidataId: null };
  if (!payload || typeof payload !== 'object') return empty;
  const relations = (payload as { relations?: unknown }).relations;
  if (!Array.isArray(relations)) return empty;

  let wikipediaTitle: string | null = null;
  let wikidataId: string | null = null;
  for (const rel of relations) {
    const type = (rel as { type?: unknown })?.type;
    const resource = (rel as { url?: { resource?: unknown } })?.url?.resource;
    if (typeof type !== 'string' || typeof resource !== 'string') continue;
    if (type === 'wikipedia' && !wikipediaTitle) {
      const match = resource.match(/\/wiki\/([^?#]+)$/);
      if (match?.[1]) wikipediaTitle = decodeURIComponent(match[1]);
    }
    if (type === 'wikidata' && !wikidataId) {
      const match = resource.match(/\/(Q\d+)$/);
      if (match?.[1]) wikidataId = match[1];
    }
  }
  return { wikipediaTitle, wikidataId };
}

export function buildWikidataEntityUrl(wikidataId: string): string {
  return `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`;
}

export function parseWikidataEnwikiTitle(payload: unknown, wikidataId: string): string | null {
  const entities = (payload as { entities?: Record<string, unknown> })?.entities;
  const entity = entities?.[wikidataId] as
    | { sitelinks?: { enwiki?: { title?: unknown } } }
    | undefined;
  const title = entity?.sitelinks?.enwiki?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

export function buildWikipediaSummaryUrl(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/ /g, '_'),
  )}`;
}

export function parseWikipediaExtract(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { extract?: unknown; type?: unknown };
  // Disambiguation pages have an extract, but it describes the page, not the subject.
  if (record.type === 'disambiguation') return null;
  const extract = record.extract;
  return typeof extract === 'string' && extract.trim() ? extract.trim() : null;
}

/** `undefined` = lookup failed (do not cache); `null` = nothing exists. */
async function getJson(url: string): Promise<unknown | undefined> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json' } },
      LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchMusicDescription(
  kind: MusicDescriptionKind,
  name: string,
  artist: string,
): Promise<string | null> {
  const trimmedName = name?.trim() ?? '';
  if (!trimmedName) return null;

  const cached = getCachedMusicDescription(kind, trimmedName, artist);
  if (cached !== null) return cached === MISS ? null : cached;

  const search = await getJson(buildMusicBrainzSearchUrl(kind, trimmedName, artist));
  if (search === undefined) return null;
  const mbid = parseMusicBrainzMbid(kind, search);
  if (!mbid) {
    cacheMusicDescription(kind, trimmedName, artist, MISS);
    return null;
  }

  const relations = await getJson(buildMusicBrainzRelationsUrl(kind, mbid));
  if (relations === undefined) return null;
  const { wikipediaTitle, wikidataId } = parseMusicBrainzRelations(relations);

  let title = wikipediaTitle;
  if (!title && wikidataId) {
    const entity = await getJson(buildWikidataEntityUrl(wikidataId));
    if (entity === undefined) return null;
    title = parseWikidataEnwikiTitle(entity, wikidataId);
  }
  if (!title) {
    cacheMusicDescription(kind, trimmedName, artist, MISS);
    return null;
  }

  const summary = await getJson(buildWikipediaSummaryUrl(title));
  if (summary === undefined) return null;
  const extract = parseWikipediaExtract(summary);
  cacheMusicDescription(kind, trimmedName, artist, extract ?? MISS);
  return extract;
}
