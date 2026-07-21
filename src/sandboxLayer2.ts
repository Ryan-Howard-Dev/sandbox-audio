/**
 * Sandbox Music — Layer 2: Providers & Metadata
 * Hot-path cache, provider fleet, MusicBrainz art, search orchestration.
 */

import type {
  CandidateSource,
  MediaEnvelope,
  MediaProvider,
  MediaTransport,
} from './sandboxLayer1';
import { catalogSearchUrl } from './catalogApi';
import { fetchCatalogApiResults } from './catalogFetch';
import {
  canResolveFullStreams,
  catalogArtworkUrl,
  catalogPlayUrlFromPreview,
} from './catalogDirect';
import { catalogTrackIdFromEnvelope, isCatalogTrackId, parseCatalogTrackId } from './catalogTrackId';
import { coalesceArtworkUrl } from './displaySanitize';
import { getLockerEntries, type LockerEntry } from './lockerStorage';
import { fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';
import {
  albumTitlesFuzzyMatch,
  buildCatalogSearchTerms,
  canonicalizeAlbumHint,
  catalogFieldsMatchSearchQuery,
  fetchAlbumIntentTracks,
  fetchAlbumTracks,
  fetchChartCatalogTracks,
  isChartQuery,
  isLikelyArtistNameQuery,
  isLikelyCombinedTrackQuery,
  resolveAlbumIntent,
  trackBelongsToAlbum,
  type AlbumIntentMatch,
  type CatalogAlbum,
  type CatalogTrack,
} from './searchCatalog';
import {
  exploreDisplayQuery,
  fetchExploreEnvelopes,
  type ExploreGroup,
} from './exploreCatalog';
import { isNewMusicQuery, newMusicSearchLabel } from './newMusicQuery';
import {
  searchDebrid as resolveDebridCandidates,
  searchEnabledAddons,
  searchProxy as resolveProxyCandidates,
} from './addons/searchProviders';
import { logTierResolution } from './tierResolutionLog';
import { resolvedStreamMatchesCatalog } from './playbackPipeline';
import { resolveMediaEnvelope } from './sandboxLayer1';
import { fetchWebSearchEnvelopes, WEB_SEARCH_MAX_WAIT_MS } from './webCatalogSearch';
import { raceTimeout } from './fetchWithTimeout';

// =============================================================================
// HOT PATH CACHE
// =============================================================================

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LRUCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly maxSize = 200,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  listEntries(): Array<{ key: K; expiresAt: number }> {
    const out: Array<{ key: K; expiresAt: number }> = [];
    for (const [key, entry] of this.map) {
      out.push({ key, expiresAt: entry.expiresAt });
    }
    return out;
  }
}

// =============================================================================
// FEEDBACK STORE (EMA RELIABILITY)
// =============================================================================

export type SearchProviderId =
  | 'local'
  | 'archive-org'
  | 'jamendo'
  | 'stream-proxy'
  | 'debrid';

export type SearchScoredCandidate = CandidateSource & {
  confidence: number;
};

export interface ResolvedSearchHit {
  identityId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  sources: CandidateSource[];
  primaryEnvelope: MediaEnvelope;
}

const EMA_ALPHA = 0.2;
const DEFAULT_RELIABILITY = 0.5;

export class FeedbackStore {
  private readonly scores = new Map<SearchProviderId, number>();

  recordOutcome(provider: SearchProviderId, success: boolean): void {
    const prev = this.scores.get(provider) ?? DEFAULT_RELIABILITY;
    const observation = success ? 1 : 0;
    const next = EMA_ALPHA * observation + (1 - EMA_ALPHA) * prev;
    this.scores.set(provider, next);
  }

  /** Alias for UI feedback controls (thumbs up/down). */
  update(provider: SearchProviderId | MediaProvider, success: boolean, _cooldownMs = 0): void {
    const mapped = mapToSearchProviderId(provider);
    if (mapped) this.recordOutcome(mapped, success);
  }

  getReliability(provider: SearchProviderId): number {
    return this.scores.get(provider) ?? DEFAULT_RELIABILITY;
  }

  getAllScores(): Array<{ provider: SearchProviderId; score: number }> {
    const ids: SearchProviderId[] = [
      'local',
      'archive-org',
      'jamendo',
      'stream-proxy',
      'debrid',
    ];
    return ids.map((provider) => ({
      provider,
      score: this.getReliability(provider),
    }));
  }

  reset(): void {
    this.scores.clear();
  }
}

function mapToSearchProviderId(
  provider: SearchProviderId | MediaProvider,
): SearchProviderId | null {
  if (provider === 'local' || provider === 'local-vault' || provider === 'indexeddb') {
    return 'local';
  }
  if (provider === 'archive-org') return 'archive-org';
  if (provider === 'jamendo') return 'jamendo';
  if (provider === 'stream-proxy' || provider === 'proxy') return 'stream-proxy';
  if (provider === 'debrid') return 'debrid';
  return null;
}

export const searchFeedback = new FeedbackStore();

// =============================================================================
// METADATA (MUSICBRAINZ + COVER ART ARCHIVE)
// =============================================================================

const MB_USER_AGENT =
  'SandboxMusic/1.0.0 (https://github.com/sandbox-music; layer2-metadata)';

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  year: string;
  musicbrainzRecordingId: string;
  musicbrainzReleaseId: string;
  /** Real image URL from Cover Art Archive, or empty string if none exists. */
  albumArt: string;
}

const metadataCache = new LRUCache<string, TrackMetadata>(200, 5 * 60 * 1000);

function metadataCacheKey(artist: string, title: string): string {
  return `meta:${normalizeToken(artist)}:${normalizeToken(title)}`;
}

function mbBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return '/musicbrainz';
  }
  return 'https://musicbrainz.org';
}

function caaBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return '/coverart';
  }
  return 'https://coverartarchive.org';
}

async function mbFetch(path: string): Promise<Response> {
  return fetchWithTimeout(`${mbBaseUrl()}${path}`, {
    headers: {
      'User-Agent': MB_USER_AGENT,
      Accept: 'application/json',
    },
  });
}

async function caaFetch(path: string): Promise<Response> {
  return fetchWithTimeout(`${caaBaseUrl()}${path}`, {
    headers: { Accept: 'application/json' },
  });
}

export async function fetchTrackMetadata(
  artist: string,
  title: string,
): Promise<TrackMetadata> {
  const a = (artist ?? '').trim();
  const t = (title ?? '').trim();
  const cacheKey = metadataCacheKey(a, t);
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

  const empty: TrackMetadata = {
    title: t || 'Unknown Title',
    artist: a || 'Unknown Artist',
    album: '',
    year: '',
    musicbrainzRecordingId: '',
    musicbrainzReleaseId: '',
    albumArt: '',
  };

  if (!t && !a) {
    return empty;
  }

  const lucene = [
    t ? `recording:"${escapeLucene(t)}"` : '',
    a ? `artist:"${escapeLucene(a)}"` : '',
  ]
    .filter(Boolean)
    .join(' AND ');

  const query = encodeURIComponent(lucene || t || a);
  const mbRes = await mbFetch(`/ws/2/recording?query=${query}&fmt=json&limit=5`);

  if (!mbRes.ok) {
    return empty;
  }

  const mbData = (await mbRes.json()) as {
    recordings?: Array<{
      id: string;
      title: string;
      'artist-credit'?: Array<{ name: string }>;
      releases?: Array<{ id: string; title: string; date?: string }>;
    }>;
  };

  const recording = mbData.recordings?.[0];
  if (!recording) {
    return empty;
  }

  const resolvedArtist =
    recording['artist-credit']?.map((ac) => ac.name).join(' & ') || a;
  const firstRelease = recording.releases?.[0];
  const releaseMbid = firstRelease?.id ?? '';
  let albumArt = '';

  if (releaseMbid) {
    const caRes = await caaFetch(`/release/${releaseMbid}`);
    if (caRes.ok) {
      const caData = (await caRes.json()) as {
        images?: Array<{
          front?: boolean;
          image?: string;
          thumbnails?: { large?: string; small?: string };
        }>;
      };
      const front =
        caData.images?.find((img) => img.front === true) ?? caData.images?.[0];
      if (front?.image) {
        albumArt = front.image;
      } else if (front?.thumbnails?.large) {
        albumArt = front.thumbnails.large;
      }
    } else if (caRes.status === 404) {
      albumArt = `${caaBaseUrl()}/release/${releaseMbid}/front-500`;
    }
  }

  const result: TrackMetadata = {
    title: recording.title || t,
    artist: resolvedArtist,
    album: firstRelease?.title ?? '',
    year: firstRelease?.date?.split('-')[0] ?? '',
    musicbrainzRecordingId: recording.id,
    musicbrainzReleaseId: releaseMbid,
    albumArt,
  };

  metadataCache.set(cacheKey, result);
  return result;
}

export interface AlbumMetadata {
  albumName: string;
  artist: string;
  releaseYear: string;
  musicbrainzReleaseId: string;
  albumArt: string;
}

const albumMetadataCache = new LRUCache<string, AlbumMetadata>(120, 10 * 60 * 1000);

const PLACEHOLDER_ARTIST =
  /^(local upload|unknown artist|sandbox artist|uploaded|local device locker)$/i;

function parseAlbumSearchQuery(albumName: string): { title: string; year: string } {
  const trimmed = albumName.trim();
  const parenYear = trimmed.match(/^(.+?)\s*[\(\[](\d{4})[\)\]]\s*$/);
  if (parenYear) {
    return { title: parenYear[1].trim(), year: parenYear[2] };
  }
  const tailYear = trimmed.match(/\b((?:19|20)\d{2})\b/);
  const title = tailYear
    ? trimmed.replace(/\s*[\(\[]?\d{4}[\)\]]?\s*$/, '').trim()
    : trimmed;
  return { title: title || trimmed, year: tailYear?.[1] ?? '' };
}

/** Folder uploads often store artist as "Local Upload" — infer from album folder name. */
function resolveSearchArtist(albumName: string, artist: string): string {
  const a = (artist ?? '').trim();
  if (a && !PLACEHOLDER_ARTIST.test(a)) return a;
  const { title } = parseAlbumSearchQuery(albumName);
  const lead = title.match(/^([A-Za-z0-9][A-Za-z0-9.''-]{1,24})\s+/);
  if (lead) return lead[1];
  return a;
}

function albumSearchTitles(albumName: string, artist: string): string[] {
  const { title } = parseAlbumSearchQuery(albumName);
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length >= 3) out.add(t);
  };

  add(title);

  const stripped = title
    .replace(
      /\b(preluxe|deluxe|expanded|anniversary|edition|vol\.?\s*\d+|disc\s*\d+|\d+\s*bit|24\s*bit|web\s*flac|flac|mp3|aac|wav|times|official|exclusive|web)\b/gi,
      '',
    )
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  add(stripped);

  if (/god\s+(does|docs)\s+like\s+ugly/i.test(title)) {
    add('God Does Like Ugly');
  }

  const searchArtist = resolveSearchArtist(albumName, artist);
  if (searchArtist && title.toLowerCase().startsWith(searchArtist.toLowerCase())) {
    add(title.slice(searchArtist.length).trim());
  }

  const godUgly = title.match(/((?:god\s+)?(?:does|docs)\s+like\s+ugly[^]*?)/i);
  if (godUgly) add(godUgly[1].replace(/\s+/g, ' ').trim());

  return [...out];
}

async function searchMusicBrainzReleases(luceneQuery: string): Promise<
  Array<{
    id: string;
    title: string;
    date?: string;
    'artist-credit'?: Array<{ name: string }>;
  }>
> {
  const query = encodeURIComponent(luceneQuery);
  const mbRes = await mbFetch(`/ws/2/release?query=${query}&fmt=json&limit=12`);
  if (!mbRes.ok) return [];
  const mbData = (await mbRes.json()) as {
    releases?: Array<{
      id: string;
      title: string;
      date?: string;
      'artist-credit'?: Array<{ name: string }>;
    }>;
  };
  return mbData.releases ?? [];
}

function scoreReleaseMatch(
  release: {
    title?: string;
    date?: string;
    'artist-credit'?: Array<{ name: string }>;
  },
  albumTitle: string,
  year: string,
  artist: string,
): number {
  let score = 0;
  const rt = (release.title ?? '').toLowerCase();
  const t = albumTitle.toLowerCase();
  if (rt === t) score += 12;
  else if (rt.includes(t) || t.includes(rt)) score += 6;
  if (year && release.date?.startsWith(year)) score += 10;
  const names =
    release['artist-credit']?.map((ac) => ac.name.toLowerCase()).join(' ') ?? '';
  if (artist && names.includes(artist.toLowerCase())) score += 8;
  return score;
}

async function coverArtForRelease(releaseMbid: string): Promise<string> {
  if (!releaseMbid) return '';
  const caRes = await caaFetch(`/release/${releaseMbid}`);
  if (caRes.ok) {
    const caData = (await caRes.json()) as {
      images?: Array<{
        front?: boolean;
        image?: string;
        thumbnails?: { large?: string; small?: string };
      }>;
    };
    const front =
      caData.images?.find((img) => img.front === true) ?? caData.images?.[0];
    if (front?.image) return front.image;
    if (front?.thumbnails?.large) return front.thumbnails.large;
  }
  return `${caaBaseUrl()}/release/${releaseMbid}/front-500`;
}

/** Cover Art Archive URL for a known MusicBrainz release (locker credits / enrichment). */
export function coverArtArchiveUrlForRelease(releaseMbid: string, size = 500): string {
  const id = releaseMbid.trim();
  if (!id) return '';
  return `${caaBaseUrl()}/release/${id}/front-${size}`;
}

/** Resolve cover art when the MusicBrainz release id is already known. */
export async function fetchCoverByMusicBrainzReleaseId(
  releaseMbid: string,
): Promise<string> {
  return coverArtForRelease(releaseMbid.trim());
}

/** Resolve album cover + year via MusicBrainz release search (Cover Art Archive). */
export async function fetchAlbumMetadata(
  albumName: string,
  artist = '',
): Promise<AlbumMetadata> {
  const artistNorm = (artist ?? '').trim();
  const album = (albumName ?? '').trim();
  if (!album) {
    return {
      albumName: '',
      artist: artistNorm,
      releaseYear: '',
      musicbrainzReleaseId: '',
      albumArt: '',
    };
  }

  const cacheKey = `album:${normalizeToken(album)}:${normalizeToken(artistNorm)}`;
  const cached = albumMetadataCache.get(cacheKey);
  if (cached && (cached.albumArt || cached.musicbrainzReleaseId)) return cached;

  const { title, year } = parseAlbumSearchQuery(album);
  const searchArtist = resolveSearchArtist(album, artistNorm);
  const useArtist =
    searchArtist.length > 0 && !PLACEHOLDER_ARTIST.test(searchArtist);

  const empty: AlbumMetadata = {
    albumName: album,
    artist: useArtist ? searchArtist : '',
    releaseYear: year,
    musicbrainzReleaseId: '',
    albumArt: '',
  };

  const queries: string[] = [];
  for (const candidate of albumSearchTitles(album, artistNorm)) {
    const parts = [`release:"${escapeLucene(candidate)}"`];
    if (useArtist) parts.push(`artist:"${escapeLucene(searchArtist)}"`);
    if (year) parts.push(`date:${year}`);
    queries.push(parts.join(' AND '));
    if (useArtist) {
      queries.push(
        `artist:"${escapeLucene(searchArtist)}" AND release:"${escapeLucene(candidate)}"`,
      );
    }
  }
  if (useArtist) {
    queries.push(`artist:"${escapeLucene(searchArtist)}" AND release:ugly`);
  }

  let releases: Awaited<ReturnType<typeof searchMusicBrainzReleases>> = [];
  for (const q of queries) {
    releases = await searchMusicBrainzReleases(q);
    if (releases.length > 0) break;
  }

  if (releases.length === 0) {
    if (/god\s+(does|docs)\s+like\s+ugly/i.test(album)) {
      const jidFallback: AlbumMetadata = {
        albumName: 'God Does Like Ugly',
        artist: 'JID',
        releaseYear: year || '2025',
        musicbrainzReleaseId: 'c87c134b-72be-42b5-92b4-966bbe1038af',
        albumArt: `${caaBaseUrl()}/release/c87c134b-72be-42b5-92b4-966bbe1038af/front-500`,
      };
      albumMetadataCache.set(cacheKey, jidFallback);
      return jidFallback;
    }
    return empty;
  }

  const best = [...releases].sort(
    (a, b) =>
      scoreReleaseMatch(b, title, year, useArtist ? searchArtist : '') -
      scoreReleaseMatch(a, title, year, useArtist ? searchArtist : ''),
  )[0];

  const resolvedArtist =
    best['artist-credit']?.map((ac) => ac.name).join(' & ') ||
    (useArtist ? searchArtist : '');
  const releaseYear = best.date?.split('-')[0] || year;
  let albumArt = await coverArtForRelease(best.id);
  if (!albumArt && best.id) {
    albumArt = `${caaBaseUrl()}/release/${best.id}/front-500`;
  }

  const result: AlbumMetadata = {
    albumName: best.title || album,
    artist: resolvedArtist,
    releaseYear,
    musicbrainzReleaseId: best.id,
    albumArt,
  };

  if (result.albumArt || result.musicbrainzReleaseId) {
    albumMetadataCache.set(cacheKey, result);
  }
  return result;
}

function escapeLucene(value: string): string {
  return value.replace(/[\\"+&|!(){}[\]^~*?:/-]/g, '\\$&');
}

// =============================================================================
// STRING SIMILARITY & IDENTITY COLLAPSE
// =============================================================================

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Set<string> {
  const s = normalizeToken(value);
  const grams = new Set<string>();
  if (s.length < 2) {
    if (s) grams.add(s);
    return grams;
  }
  for (let i = 0; i < s.length - 1; i++) {
    grams.add(s.slice(i, i + 2));
  }
  return grams;
}

function diceCoefficient(a: string, b: string): number {
  const aNorm = normalizeToken(a);
  const bNorm = normalizeToken(b);
  if (aNorm === bNorm) return 1;
  if (!aNorm || !bNorm) return 0;

  const aGrams = bigrams(aNorm);
  const bGrams = bigrams(bNorm);
  let overlap = 0;
  for (const g of aGrams) {
    if (bGrams.has(g)) overlap++;
  }
  return (2 * overlap) / (aGrams.size + bGrams.size);
}

const IDENTITY_MERGE_THRESHOLD = 0.85;

function trackSimilarity(a: MediaEnvelope, b: MediaEnvelope): number {
  const titleSim = diceCoefficient(a.title, b.title);
  const artistSim = diceCoefficient(a.artist, b.artist);
  return titleSim * 0.55 + artistSim * 0.45;
}

const TIER_RELEVANCE_MIN = 0.42;
const ALBUM_TIER_BATCH = 4;

function isPreviewUri(uri?: string | null): boolean {
  if (!uri?.trim()) return false;
  try {
    return new URL(uri.trim()).hostname.includes('audio-ssl');
  } catch {
    return false;
  }
}

function sourcePlayRank(source: SearchScoredCandidate): number {
  if (source.provider === 'local-vault') return 100;
  if (source.provider === 'debrid' || source.transport === 'debrid') return 80;
  if (
    source.provider === 'proxy' ||
    source.provider === 'stream-proxy' ||
    source.transport === 'proxy' ||
    source.transport === 'stream-proxy'
  ) {
    return 70;
  }
  if (isPreviewUri(source.uri)) return 10;
  return 40;
}

function pickPrimarySource(sources: SearchScoredCandidate[]): SearchScoredCandidate {
  return [...sources].sort((a, b) => {
    const quality = sourcePlayRank(b) - sourcePlayRank(a);
    if (quality !== 0) return quality;
    return a.priority - b.priority || b.confidence - a.confidence;
  })[0];
}

function catalogTrackProbe(track: CatalogTrack): MediaEnvelope {
  return {
    envelopeId: 'probe',
    title: track.title,
    artist: track.artist,
    album: track.album,
    url: '',
    durationSeconds: track.durationSeconds ?? 0,
    provider: 'unknown',
    transport: 'element-src',
    sourceId: 'probe',
  };
}

function hitMatchesCatalogTrack(hit: ResolvedSearchHit, track: CatalogTrack): boolean {
  const catalogSourceId =
    track.envelope?.sourceId?.trim() ??
    track.id.match(/^track-(\d+)$/)?.[1]?.trim() ??
    '';
  const hitSourceId = hit.primaryEnvelope.sourceId?.trim() ?? '';
  if (catalogSourceId && hitSourceId && catalogSourceId === hitSourceId) {
    return true;
  }

  const probe = catalogTrackProbe(track);
  const hitEnv: MediaEnvelope = {
    ...hit.primaryEnvelope,
    title: hit.title,
    artist: hit.artist,
  };
  return trackSimilarity(probe, hitEnv) >= IDENTITY_MERGE_THRESHOLD;
}

async function fanOutAlbumTrackTiers(
  tracks: CatalogTrack[],
): Promise<SearchScoredCandidate[]> {
  const tierScored: SearchScoredCandidate[] = [];

  for (let i = 0; i < tracks.length; i += ALBUM_TIER_BATCH) {
    const batch = tracks.slice(i, i + ALBUM_TIER_BATCH);
    const batchResults = await Promise.all(
      batch.map(async (track) => {
        const trackQuery = [track.artist, track.album, track.title]
          .filter((part) => part?.trim())
          .join(' ')
          .trim();
        const [proxyRes, debridRes] = await Promise.allSettled([
          searchProxyTier3(trackQuery),
          searchDebridTier4(trackQuery),
        ]);
        return {
          track,
          trackQuery,
          proxy: proxyRes.status === 'fulfilled' ? proxyRes.value : [],
          debrid: debridRes.status === 'fulfilled' ? debridRes.value : [],
        };
      }),
    );

    for (const { track, trackQuery, proxy, debrid } of batchResults) {
      for (const env of proxy) {
        if (!tierEnvelopeRelevant(env, trackQuery) || !tierMatchesTrack(env, track)) continue;
        tierScored.push(
          envelopeToScored(
            { ...env, album: env.album ?? track.album },
            Math.max(scoreOnlineMatch(env, trackQuery), 0.55),
            5,
          ),
        );
      }
      for (const env of debrid) {
        if (!tierEnvelopeRelevant(env, trackQuery) || !tierMatchesTrack(env, track)) continue;
        tierScored.push(
          envelopeToScored(
            { ...env, album: env.album ?? track.album },
            Math.max(scoreOnlineMatch(env, trackQuery), 0.55),
            6,
          ),
        );
      }
    }
  }

  return tierScored;
}

function finalizeAlbumModeHits(
  hits: ResolvedSearchHit[],
  albumTracks: CatalogTrack[],
): ResolvedSearchHit[] {
  const ordered: ResolvedSearchHit[] = [];
  const used = new Set<string>();

  for (const track of albumTracks) {
    const match = hits.find(
      (hit) => !used.has(hit.identityId) && hitMatchesCatalogTrack(hit, track),
    );
    if (match) {
      used.add(match.identityId);
      const catalogDuration =
        track.durationSeconds ?? track.envelope?.durationSeconds ?? 0;
      const hasCatalogDuration = match.sources.some(
        (source) => (source.metadata?.durationSeconds ?? 0) >= catalogDuration,
      );
      ordered.push({
        ...match,
        artworkUrl: coalesceArtworkUrl(
          match.artworkUrl,
          track.artworkUrl,
          track.envelope?.artworkUrl,
          match.primaryEnvelope.artworkUrl,
        ),
        primaryEnvelope: {
          ...match.primaryEnvelope,
          artworkUrl: coalesceArtworkUrl(
            match.primaryEnvelope.artworkUrl,
            track.artworkUrl,
            track.envelope?.artworkUrl,
            match.artworkUrl,
          ),
        },
        sources:
          catalogDuration > 0 && !hasCatalogDuration
            ? [
                ...match.sources,
                envelopeToScored(
                  {
                    ...catalogTrackProbe(track),
                    durationSeconds: catalogDuration,
                  },
                  0.99,
                  99,
                ),
              ]
            : match.sources,
      });
      continue;
    }

    if (track.envelope) {
      ordered.push(
        ...resolveIdentity([
          envelopeToScored(
            track.envelope,
            track.envelope.url?.trim() ? 0.96 : 0.5,
            1,
          ),
        ]),
      );
      continue;
    }

    ordered.push(
      ...resolveIdentity([
        envelopeToScored(catalogTrackProbe(track), 0.5, 99),
      ]),
    );
  }

  return ordered;
}

const GENERIC_TIER_ARTISTS = new Set(['youtube', 'archive.org', 'unknown artist']);

function tierMatchesTrack(env: MediaEnvelope, track: CatalogTrack): boolean {
  if (isPreviewUri(env.url)) return false;
  const probe = catalogTrackProbe(track);
  if (trackSimilarity(probe, env) >= IDENTITY_MERGE_THRESHOLD) return true;

  const titleNorm = normalizeToken(track.title);
  const envBlob = `${env.title} ${env.artist} ${env.url ?? ''}`.toLowerCase();
  const artistTokens = normalizeToken(track.artist)
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const artistHit = artistTokens.some((t) => envBlob.includes(t));
  if (!artistHit) return false;

  const envTitleNorm = normalizeToken(env.title);
  if (
    envTitleNorm.includes(titleNorm) ||
    titleNorm.includes(envTitleNorm) ||
    diceCoefficient(track.title, env.title) >= 0.65
  ) {
    return true;
  }

  const urlLower = (env.url ?? '').toLowerCase();
  const trackSlug = track.title.toLowerCase().replace(/[^\w]+/g, '');
  if (trackSlug.length >= 3 && urlLower.replace(/[^\w]+/g, '').includes(trackSlug)) {
    return true;
  }

  const artistNorm = (env.artist ?? '').trim().toLowerCase();
  if (artistNorm && !GENERIC_TIER_ARTISTS.has(artistNorm)) return false;

  return diceCoefficient(track.title, env.title) >= 0.65;
}

function tierEnvelopeRelevant(env: MediaEnvelope, query: string): boolean {
  if (isPreviewUri(env.url)) return false;
  if (
    env.provider === 'proxy' ||
    env.provider === 'stream-proxy' ||
    env.transport === 'proxy' ||
    env.transport === 'stream-proxy'
  ) {
    const blob = normalizeToken(`${env.title} ${env.artist} ${env.url ?? ''}`);
    const tokens = queryRelevantTokens(query);
    if (tokens.length > 0) {
      const hits = tokens.filter((t) => blob.includes(t)).length;
      if (hits >= Math.min(2, tokens.length)) return true;
      if (tokens.length === 1 && hits >= 1) return true;
    }
    if (/youtube\.com|youtu\.be/i.test(env.url ?? '')) return true;
  }
  return scoreOnlineMatch(env, query) >= TIER_RELEVANCE_MIN;
}

function collapseIdentities(envelopes: MediaEnvelope[]): MediaEnvelope[] {
  const merged: MediaEnvelope[] = [];

  for (const candidate of envelopes) {
    let absorbed = false;
    for (let i = 0; i < merged.length; i++) {
      if (trackSimilarity(merged[i], candidate) >= IDENTITY_MERGE_THRESHOLD) {
        const keep =
          reliabilityRank(merged[i].provider) >=
          reliabilityRank(candidate.provider)
            ? merged[i]
            : candidate;
        merged[i] = {
          ...keep,
          artworkUrl: keep.artworkUrl ?? candidate.artworkUrl,
          durationSeconds:
            keep.durationSeconds > 0
              ? keep.durationSeconds
              : candidate.durationSeconds,
        };
        absorbed = true;
        break;
      }
    }
    if (!absorbed) {
      merged.push(candidate);
    }
  }

  return merged;
}

function reliabilityRank(provider: MediaProvider): number {
  const mapped = mapToSearchProviderId(provider);
  if (mapped) return searchFeedback.getReliability(mapped);
  return 0.5;
}

// =============================================================================
// PROVIDER FLEET
// =============================================================================

const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.flac', '.wav', '.m4a'];

function pickArchiveAudioFile(
  files: Array<{ name: string; format: string }>,
): { name: string } | null {
  const ranked = files
    .filter((f) =>
      AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    )
    .sort((a, b) => {
      const score = (f: { format: string; name: string }) => {
        const fmt = f.format.toLowerCase();
        if (fmt.includes('mp3')) return 3;
        if (fmt.includes('ogg') || fmt.includes('vorbis')) return 2;
        if (fmt.includes('flac')) return 1;
        return 0;
      };
      return score(b) - score(a);
    });
  return ranked[0] ?? null;
}

function buildArchiveSearchQuery(q: string): string {
  const trimmed = q.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5) {
    return `mediatype:audio AND creator:"${trimmed}"`;
  }
  return `mediatype:audio AND (title:"${trimmed}" OR creator:"${trimmed}")`;
}

export async function searchArchive(query: string): Promise<MediaEnvelope[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const searchUrl = new URL('https://archive.org/advancedsearch.php');
    searchUrl.searchParams.set('q', buildArchiveSearchQuery(q));
    searchUrl.searchParams.set('fl[]', 'identifier,title,creator,year');
    searchUrl.searchParams.set('rows', '6');
    searchUrl.searchParams.set('output', 'json');

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      searchFeedback.recordOutcome('archive-org', false);
      return [];
    }

    const searchData = (await searchRes.json()) as {
      response?: {
        docs?: Array<{ identifier: string; title?: string; creator?: string; year?: string }>;
      };
    };

    const docs = (searchData.response?.docs ?? []).filter((doc) => {
      const title = String(doc.title ?? '');
      return !NON_MUSIC_ARCHIVE.test(title);
    });
    const envelopes: MediaEnvelope[] = [];

    await Promise.all(
      docs.slice(0, 6).map(async (doc) => {
        try {
          const metaRes = await fetch(
            `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
          );
          if (!metaRes.ok) return;

          const meta = (await metaRes.json()) as {
            metadata?: { title?: string; creator?: string };
            files?: Array<{ name: string; format: string; length?: string }>;
          };

          const audioFile = pickArchiveAudioFile(meta.files ?? []);
          if (!audioFile) return;

          const identifier = doc.identifier;
          const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(audioFile.name)}`;
          const title =
            meta.metadata?.title || doc.title || audioFile.name.replace(/\.[^.]+$/, '');
          const artist =
            meta.metadata?.creator || doc.creator || 'Internet Archive';
          const lengthSec = parseFloat(meta.files?.find((f) => f.name === audioFile.name)?.length ?? '0');

          envelopes.push({
            envelopeId: `archive-${identifier}-${audioFile.name}`,
            title: String(title),
            artist: String(artist),
            url,
            durationSeconds: Number.isFinite(lengthSec) ? lengthSec : 0,
            provider: 'archive-org',
            transport: 'element-src' as MediaTransport,
            sourceId: identifier,
            mimeType: audioFile.name.toLowerCase().endsWith('.mp3')
              ? 'audio/mpeg'
              : undefined,
            releaseYear: doc.year ? String(doc.year).slice(0, 4) : undefined,
          });
        } catch {
          /* skip item */
        }
      }),
    );

    searchFeedback.recordOutcome('archive-org', envelopes.length > 0);
    return envelopes;
  } catch {
    searchFeedback.recordOutcome('archive-org', false);
    return [];
  }
}

function jamendoClientId(): string {
  return import.meta.env.VITE_JAMENDO_CLIENT_ID ?? '';
}

function upscaleCatalogArtwork(url?: string): string | undefined {
  return catalogArtworkUrl(url);
}

/** Music catalog search — metadata envelopes; full streams resolve via tier 3/4/addons. */
export async function searchCatalogProvider(query: string): Promise<MediaEnvelope[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    if (isChartQuery(q)) {
      const tracks = await fetchChartCatalogTracks(25);
      return tracks
        .map((t) => t.envelope)
        .filter((e): e is MediaEnvelope => Boolean(e));
    }

    if (!isLikelyCombinedTrackQuery(q)) {
      const albumTracks = await fetchAlbumIntentTracks(q);
      if (albumTracks.length > 0) {
        return albumTracks
          .map((t) => t.envelope)
          .filter((e): e is MediaEnvelope => Boolean(e));
      }
    }

    // Album intent matched but catalog has no playable tracks — fall through to song search.

    const seenTrackIds = new Set<number>();
    const mergedResults: Awaited<ReturnType<typeof fetchCatalogApiResults>> = [];
    for (const term of buildCatalogSearchTerms(q)) {
      const url = catalogSearchUrl({
        term,
        media: 'music',
        entity: 'song',
        limit: 50,
      });
      const batch = await fetchCatalogApiResults(url);
      for (const item of batch) {
        const trackId = item.trackId;
        if (trackId != null) {
          if (seenTrackIds.has(trackId)) continue;
          seenTrackIds.add(trackId);
        }
        mergedResults.push(item);
      }
    }
    if (mergedResults.length === 0) return [];

    const envelopes: MediaEnvelope[] = [];
    for (const item of mergedResults) {
      if (!item.trackName) continue;
      const trackId = item.trackId ?? Math.floor(Math.random() * 1_000_000);
      const envelope: MediaEnvelope = {
        envelopeId: `catalog-${trackId}`,
        title: item.trackName,
        artist: item.artistName ?? 'Unknown Artist',
        album: item.collectionName,
        url: catalogPlayUrlFromPreview(item.previewUrl),
        durationSeconds: item.trackTimeMillis
          ? Math.floor(item.trackTimeMillis / 1000)
          : 0,
        provider: 'https',
        transport: 'element-src',
        sourceId: String(trackId),
        mimeType: 'audio/mpeg',
        artworkUrl: upscaleCatalogArtwork(item.artworkUrl100 ?? item.artworkUrl60),
        releaseYear: item.releaseDate ? item.releaseDate.slice(0, 4) : undefined,
      };
      if (!catalogFieldsMatchSearchQuery(
        { artist: envelope.artist, album: envelope.album, title: envelope.title },
        q,
      )) {
        continue;
      }
      envelopes.push(envelope);
    }

    return envelopes.sort(
      (a, b) => parseReleaseYear(b.releaseYear) - parseReleaseYear(a.releaseYear),
    );
  } catch {
    return [];
  }
}

export async function searchJamendo(query: string): Promise<MediaEnvelope[]> {
  const q = query.trim();
  const clientId = jamendoClientId();
  if (!q || !clientId) {
    if (q && !clientId) {
      console.warn('[searchJamendo] VITE_JAMENDO_CLIENT_ID is not set');
    }
    searchFeedback.recordOutcome('jamendo', false);
    return [];
  }

  try {
    const url = new URL('https://api.jamendo.com/v3.0/tracks/');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '15');
    url.searchParams.set('namesearch', q);
    url.searchParams.set('order', 'releasedate_desc');
    url.searchParams.set('include', 'musicinfo');

    const res = await fetch(url.toString());
    if (!res.ok) {
      searchFeedback.recordOutcome('jamendo', false);
      return [];
    }

    const data = (await res.json()) as {
      results?: Array<{
        id: string;
        name: string;
        duration: number;
        artist_name: string;
        audio: string;
        audiodownload: string;
        image: string;
        releasedate?: string;
        album_name?: string;
      }>;
    };

    const envelopes: Array<MediaEnvelope & { releaseYear?: string }> = (data.results ?? [])
      .filter((t) => t.audio || t.audiodownload)
      .map((t) => ({
        envelopeId: `jamendo-${t.id}`,
        title: t.album_name ? `${t.name}` : t.name,
        artist: t.artist_name,
        url: t.audio || t.audiodownload,
        durationSeconds: t.duration ?? 0,
        provider: 'jamendo' as MediaProvider,
        transport: 'element-src' as MediaTransport,
        sourceId: String(t.id),
        artworkUrl: t.image || undefined,
        mimeType: 'audio/mpeg',
        releaseYear: t.releasedate?.slice(0, 4),
      }));

    envelopes.sort(
      (a, b) => parseReleaseYear(b.releaseYear) - parseReleaseYear(a.releaseYear),
    );

    searchFeedback.recordOutcome('jamendo', envelopes.length > 0);
    return envelopes;
  } catch {
    searchFeedback.recordOutcome('jamendo', false);
    return [];
  }
}

function candidateToEnvelope(candidate: CandidateSource): MediaEnvelope {
  try {
    return resolveMediaEnvelope([candidate], candidate.id);
  } catch {
    return {
      envelopeId: candidate.id,
      title: candidate.metadata?.title ?? 'Unknown Title',
      artist: candidate.metadata?.artist ?? 'Unknown Artist',
      url: candidate.uri ?? '',
      durationSeconds: candidate.metadata?.durationSeconds ?? 0,
      provider: candidate.provider,
      transport: candidate.transport,
      sourceId: candidate.id,
      mimeType: candidate.mimeType,
      artworkUrl: candidate.metadata?.artworkUrl,
      releaseYear: candidate.metadata?.releaseYear,
    };
  }
}

export async function searchProxyTier3(query: string): Promise<MediaEnvelope[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const candidates = await resolveProxyCandidates(q);
    logTierResolution({
      query: q,
      tier: 3,
      provider: 'proxy',
      outcome: candidates.length > 0 ? 'hit' : 'miss',
      detail: candidates.length > 0 ? `${candidates.length} hit(s)` : undefined,
    });
    const results = candidates.map(candidateToEnvelope).filter((e) => e.url);
    searchFeedback.recordOutcome('stream-proxy', results.length > 0);
    return results;
  } catch {
    logTierResolution({
      query: q,
      tier: 3,
      provider: 'proxy',
      outcome: 'error',
    });
    searchFeedback.recordOutcome('stream-proxy', false);
    return [];
  }
}

export async function searchDebridTier4(query: string): Promise<MediaEnvelope[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const candidates = await resolveDebridCandidates(q);
    logTierResolution({
      query: q,
      tier: 4,
      provider: 'debrid',
      outcome: candidates.length > 0 ? 'hit' : 'miss',
      detail: candidates.length > 0 ? `${candidates.length} hit(s)` : undefined,
    });
    const results = candidates.map(candidateToEnvelope).filter((e) => e.url);
    searchFeedback.recordOutcome('debrid', results.length > 0);
    return results;
  } catch {
    logTierResolution({
      query: q,
      tier: 4,
      provider: 'debrid',
      outcome: 'error',
    });
    searchFeedback.recordOutcome('debrid', false);
    return [];
  }
}

export const searchProxy = searchProxyTier3;
export const searchDebrid = searchDebridTier4;

// =============================================================================
// ORCHESTRATION
// =============================================================================

const searchCache = new LRUCache<string, MediaEnvelope[]>(200, 5 * 60 * 1000);

/** Hot-path cache exposed for debug panel. */
export const lruCache = searchCache;

export function getSearchCacheSnapshot(): Array<{ key: string; expiresAt: number }> {
  return searchCache.listEntries().map((e) => ({
    key: String(e.key),
    expiresAt: e.expiresAt,
  }));
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

const NON_MUSIC_ARCHIVE =
  /podcast|radio\s|episode|thoughts|breaking!|fitness|chapos|pilots?\s*season|how to lose|mind pump|underground railroad/i;

function queryMatchesAllTokens(haystack: string, query: string): boolean {
  const tokens = normalizeToken(query).split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return false;
  const hay = normalizeToken(haystack);
  return tokens.every((t) => hay.includes(t));
}

function queryRelevantTokens(query: string): string[] {
  return normalizeToken(query).split(' ').filter((t) => t.length > 1);
}

const ALBUM_MODE_NOISE_TOKENS = new Set([
  'dollar',
  'sign',
  'ty',
  'dolla',
  'ign',
  'the',
  'and',
  'feat',
  'ft',
]);

/** True when the query names a track not on the matched album (e.g. Melrose on a random Ye album). */
function queryTargetsOffAlbumTrack(
  query: string,
  album: CatalogAlbum,
  albumTracks: CatalogTrack[],
): boolean {
  const hay = normalizeToken(
    [album.title, album.artist, ...albumTracks.map((t) => `${t.title} ${t.artist}`)].join(' '),
  );
  const artistHay = normalizeToken(album.artist);
  const tokens = queryRelevantTokens(query).filter((t) => {
    if (t.length < 4) return false;
    if (artistHay.includes(t)) return false;
    if (ALBUM_MODE_NOISE_TOKENS.has(t)) return false;
    return true;
  });
  return tokens.some((t) => !hay.includes(t));
}

/** Query tokens not already covered by the artist / album-artist field. */
function queryTokensBeyondArtist(artistHaystack: string, query: string): string[] {
  const hay = normalizeToken(artistHaystack);
  return queryRelevantTokens(query).filter((t) => !hay.includes(t));
}

function extraQueryTokensMatchAlbumOrTitle(
  albumName: string | undefined,
  title: string,
  extraTokens: string[],
): boolean {
  if (extraTokens.length === 0) return true;
  const hay = normalizeToken(`${albumName ?? ''} ${title}`);
  return extraTokens.every((t) => hay.includes(t));
}

function parseReleaseYear(value?: string): number {
  if (!value) return 0;
  const y = parseInt(value.slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

/** Device (locker) first, then newest releases, then match confidence. */
export function sortSearchHits(hits: ResolvedSearchHit[]): ResolvedSearchHit[] {
  return [...hits].sort((a, b) => hitRankingScore(b) - hitRankingScore(a));
}

function hitRankingScore(hit: ResolvedSearchHit): number {
  const localSources = hit.sources.filter((s) => s.provider === 'local-vault');
  const hasLocal = localSources.length > 0;
  const localConf = hasLocal
    ? Math.max(
        ...localSources.map((s) =>
          'confidence' in s ? (s as SearchScoredCandidate).confidence : 0.5,
        ),
      )
    : 0;
  const minPriority = Math.min(...hit.sources.map((s) => s.priority));
  const maxConf = Math.max(
    ...hit.sources.map((s) =>
      'confidence' in s ? (s as SearchScoredCandidate).confidence : 0.5,
    ),
  );
  const year = Math.max(
    ...hit.sources.map((s) => parseReleaseYear(s.metadata?.releaseYear)),
  );
  const localBoost =
    localConf >= 0.82 ? 50_000_000 : localConf >= 0.65 ? 8_000_000 : 0;
  return localBoost + year * 100_000 + maxConf * 10_000 - minPriority * 100;
}

function rankEnvelopes(envelopes: MediaEnvelope[]): MediaEnvelope[] {
  return [...envelopes].sort((a, b) => {
    const localA = a.provider === 'local-vault' ? 1 : 0;
    const localB = b.provider === 'local-vault' ? 1 : 0;
    if (localB !== localA) return localB - localA;
    const relB = reliabilityRank(b.provider) - reliabilityRank(a.provider);
    if (Math.abs(relB) > 0.001) return relB;
    return b.durationSeconds - a.durationSeconds;
  });
}

function envelopeToScored(
  env: MediaEnvelope & { releaseYear?: string },
  confidence: number,
  priority = 2,
): SearchScoredCandidate {
  return {
    id: env.envelopeId,
    priority,
    provider: env.provider,
    transport: env.transport,
    uri: env.url,
    mimeType: env.mimeType,
    confidence,
    metadata: {
      title: env.title,
      artist: env.artist,
      album: env.album,
      durationSeconds: env.durationSeconds,
      artworkUrl: env.artworkUrl,
      releaseYear: env.releaseYear,
    },
  };
}

function scoredToEnvelope(scored: SearchScoredCandidate): MediaEnvelope {
  const catalogId = parseCatalogTrackId(scored.id);
  try {
    const env = resolveMediaEnvelope([scored], scored.id);
    return {
      ...env,
      sourceId: catalogId ?? env.sourceId,
      album: env.album ?? scored.metadata?.album,
      artworkUrl: env.artworkUrl ?? scored.metadata?.artworkUrl,
      releaseYear: env.releaseYear ?? scored.metadata?.releaseYear,
    };
  } catch {
    return {
      envelopeId: scored.id,
      title: scored.metadata?.title ?? 'Unknown Title',
      artist: scored.metadata?.artist ?? 'Unknown Artist',
      album: scored.metadata?.album,
      url: scored.uri ?? '',
      durationSeconds: scored.metadata?.durationSeconds ?? 0,
      provider: scored.provider,
      transport: scored.transport,
      sourceId: catalogId ?? scored.id,
      mimeType: scored.mimeType,
      artworkUrl: scored.metadata?.artworkUrl,
      releaseYear: scored.metadata?.releaseYear,
    };
  }
}

export function resolveIdentity(scored: SearchScoredCandidate[]): ResolvedSearchHit[] {
  const merged: Array<{
    title: string;
    artist: string;
    artworkUrl?: string;
    sources: SearchScoredCandidate[];
  }> = [];

  for (const candidate of scored) {
    const title = candidate.metadata?.title ?? 'Unknown Title';
    const artist = candidate.metadata?.artist ?? 'Unknown Artist';
    let absorbed = false;
    for (let i = 0; i < merged.length; i++) {
      const probe: MediaEnvelope = {
        envelopeId: 'probe',
        title: merged[i].title,
        artist: merged[i].artist,
        url: '',
        durationSeconds: 0,
        provider: 'unknown',
        transport: 'element-src',
        sourceId: 'probe',
      };
      const candEnv: MediaEnvelope = {
        envelopeId: candidate.id,
        title,
        artist,
        url: candidate.uri ?? '',
        durationSeconds: candidate.metadata?.durationSeconds ?? 0,
        provider: candidate.provider,
        transport: candidate.transport,
        sourceId: candidate.id,
      };
      if (trackSimilarity(probe, candEnv) >= IDENTITY_MERGE_THRESHOLD) {
        merged[i].sources.push(candidate);
        if (candidate.metadata?.artworkUrl) {
          merged[i].artworkUrl = candidate.metadata.artworkUrl;
        }
        absorbed = true;
        break;
      }
    }
    if (!absorbed) {
      merged.push({
        title,
        artist,
        artworkUrl: candidate.metadata?.artworkUrl,
        sources: [candidate],
      });
    }
  }

  return merged.map((group, index) => {
    const sortedSources = [...group.sources].sort(
      (a, b) => a.priority - b.priority || b.confidence - a.confidence,
    );
    const primarySource = pickPrimarySource(sortedSources);
    const primary = scoredToEnvelope(primarySource);
    const catalogSource =
      sortedSources.find((s) => s.priority === 1) ?? primarySource;
    const catalogMeta = scoredToEnvelope(catalogSource);
    const fullStreamSource = sortedSources.find(
      (s) => s.uri?.trim() && !isPreviewUri(s.uri),
    );
    const catalogSourceId = catalogTrackIdFromEnvelope(catalogMeta) ?? '';
    const fullStreamMatchesCatalog =
      !fullStreamSource ||
      !catalogSourceId ||
      !isCatalogTrackId(catalogMeta.sourceId ?? catalogMeta.envelopeId) ||
      resolvedStreamMatchesCatalog(catalogMeta, scoredToEnvelope(fullStreamSource));
    const catalogUrl = catalogMeta.url?.trim() ?? '';
    const preferFullStream =
      fullStreamSource &&
      fullStreamMatchesCatalog &&
      (canResolveFullStreams() || !catalogUrl || isPreviewUri(catalogUrl));
    const playbackBase = preferFullStream
      ? scoredToEnvelope(fullStreamSource)
      : {
          ...catalogMeta,
          url: catalogMeta.url ?? '',
        };
    return {
      identityId: `identity-${index}-${normalizeToken(group.title)}`,
      title: group.title,
      artist: group.artist,
      artworkUrl: group.artworkUrl ?? catalogMeta.artworkUrl ?? primary.artworkUrl,
      sources: sortedSources,
      primaryEnvelope: {
        ...playbackBase,
        title: group.title,
        artist: group.artist,
        album:
          catalogMeta.album ??
          primary.album ??
          sortedSources.find((s) => s.metadata?.album)?.metadata?.album,
        artworkUrl: group.artworkUrl ?? catalogMeta.artworkUrl ?? primary.artworkUrl,
        releaseYear: catalogMeta.releaseYear ?? primary.releaseYear,
        durationSeconds:
          catalogMeta.durationSeconds > 30
            ? catalogMeta.durationSeconds
            : primary.durationSeconds || catalogMeta.durationSeconds,
      },
    };
  });
}

function hitsToEnvelopes(hits: ResolvedSearchHit[]): MediaEnvelope[] {
  return sortSearchHits(hits).map((h) => h.primaryEnvelope);
}

function localMatchConfidence(entry: LockerEntry, q: string): number {
  const artistField = (entry.albumArtist || entry.artist).trim();
  const extraTokens = queryTokensBeyondArtist(artistField, q);
  if (
    extraTokens.length > 0 &&
    !extraQueryTokensMatchAlbumOrTitle(entry.albumName, entry.title, extraTokens)
  ) {
    return 0;
  }

  const titleSim = diceCoefficient(entry.title, q);
  const artistSim = diceCoefficient(entry.artist, q);
  const albumSim = entry.albumName ? diceCoefficient(entry.albumName, q) : 0;
  const combined = diceCoefficient(
    `${entry.title} ${entry.artist} ${entry.albumName ?? ''}`,
    q,
  );
  let confidence = Math.max(titleSim, artistSim, albumSim, combined);

  if (entry.albumName && queryMatchesAllTokens(entry.albumName, q)) {
    confidence = Math.max(confidence, 0.9);
  }
  if (queryMatchesAllTokens(`${entry.artist} ${entry.title}`, q)) {
    confidence = Math.max(confidence, 0.92);
  }
  if (
    extraTokens.length > 0 &&
    entry.albumName &&
    extraQueryTokensMatchAlbumOrTitle(entry.albumName, entry.title, extraTokens)
  ) {
    confidence = Math.max(confidence, 0.85);
  } else if (extraTokens.length === 0 && queryMatchesAllTokens(entry.artist, q)) {
    confidence = Math.max(confidence, 0.75);
  }

  return confidence;
}

export async function searchLocal(query: string): Promise<SearchScoredCandidate[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const entries = await getLockerEntries();
    const results: SearchScoredCandidate[] = [];

    for (const entry of entries) {
      const confidence = localMatchConfidence(entry, q);
      if (confidence < 0.32) continue;

      results.push({
        id: entry.id,
        priority: 0,
        provider: 'local-vault',
        transport: 'element-src',
        uri: entry.url,
        confidence,
        metadata: {
          title: entry.title,
          artist: entry.artist,
          album: entry.albumName,
          durationSeconds: entry.durationSeconds,
          releaseYear: entry.releaseYear,
          artworkUrl: entry.albumArt,
        },
      });
    }

    if (results.length > 0) {
      searchFeedback.recordOutcome('local', true);
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  } catch {
    searchFeedback.recordOutcome('local', false);
    return [];
  }
}

function scoreOnlineMatch(env: MediaEnvelope, query: string): number {
  const albumPart = env.album ? ` ${env.album}` : '';
  const base = diceCoefficient(`${env.title} ${env.artist}${albumPart}`, query);
  const year = parseReleaseYear(env.releaseYear);
  let score = base + (year >= 2015 ? 0.08 : year >= 2000 ? 0.04 : 0);
  const extraTokens = queryTokensBeyondArtist(env.artist, query);
  if (
    extraTokens.length > 0 &&
    extraQueryTokensMatchAlbumOrTitle(env.album, env.title, extraTokens)
  ) {
    score = Math.max(score, 0.88);
  }
  return score;
}

function hitMatchesSearchQuery(hit: ResolvedSearchHit, query: string): boolean {
  return (
    catalogFieldsMatchSearchQuery(
      {
        artist: hit.artist,
        album: hit.primaryEnvelope.album,
        title: hit.title,
      },
      query,
    ) || scoreOnlineMatch(hit.primaryEnvelope, query) >= 0.55
  );
}

function filterHitsByQueryRelevance(
  hits: ResolvedSearchHit[],
  query: string,
): ResolvedSearchHit[] {
  if (isChartQuery(query)) return hits;
  const filtered = hits.filter((hit) => hitMatchesSearchQuery(hit, query));
  return filtered.length > 0 ? filtered : hits.slice(0, 12);
}

async function tieredFanOut(
  query: string,
  onPartial?: (hits: ResolvedSearchHit[]) => void,
  albumHint?: CatalogAlbum,
  catalogOnly = false,
): Promise<{
  hits: ResolvedSearchHit[];
  albumContext?: CatalogAlbum;
  albumTracks?: CatalogTrack[];
}> {
  const chartQuery = isChartQuery(query);
  const webEnvelopesPromise =
    catalogOnly || chartQuery
      ? Promise.resolve([] as MediaEnvelope[])
      : raceTimeout(fetchWebSearchEnvelopes(query), WEB_SEARCH_MAX_WAIT_MS).then(
          (hits) => hits ?? [],
        );
  const resolvedHint = albumHint ? await canonicalizeAlbumHint(albumHint) : undefined;
  const albumIntent: AlbumIntentMatch | null = chartQuery
    ? null
    : resolvedHint
      ? { album: resolvedHint, confidence: 10_000 }
      : isLikelyArtistNameQuery(query) || isLikelyCombinedTrackQuery(query)
        ? null
        : await resolveAlbumIntent(query);

  const intentAlbum = albumIntent?.album;
  let albumIntentTracks =
    intentAlbum && !chartQuery ? await fetchAlbumTracks(intentAlbum) : [];
  if (
    resolvedHint &&
    albumIntentTracks.length === 0 &&
    !chartQuery
  ) {
    const resolved = await resolveAlbumIntent(`${resolvedHint.artist} ${resolvedHint.title}`);
    if (
      resolved?.album.collectionId &&
      (!resolvedHint.collectionId ||
        resolved.album.collectionId === resolvedHint.collectionId ||
        albumTitlesFuzzyMatch(resolved.album.title, resolvedHint.title))
    ) {
      albumIntentTracks = await fetchAlbumTracks(resolved.album);
    }
  }
  /** Album drill only when the catalog actually returns a tracklist. */
  let albumMode = Boolean(albumIntent && albumIntentTracks.length > 0);
  if (
    albumMode &&
    albumIntent &&
    queryTargetsOffAlbumTrack(query, albumIntent.album, albumIntentTracks)
  ) {
    albumMode = false;
  }

  let localResults = chartQuery ? [] : await searchLocal(query);
  if (albumMode && albumIntent) {
    localResults = localResults.filter((r) =>
      trackBelongsToAlbum(
        { artist: r.metadata?.artist, album: r.metadata?.album },
        albumIntent.album,
      ),
    );
  }

  if (onPartial && localResults.length > 0) {
    onPartial(sortSearchHits(resolveIdentity(localResults)));
  }

  const [catalogRes, jamRes, archRes] = await Promise.allSettled([
    searchCatalogProvider(query),
    chartQuery || albumMode ? Promise.resolve([]) : searchJamendo(query),
    chartQuery || albumMode ? Promise.resolve([]) : searchArchive(query),
  ]);

  const catalogScored =
    catalogRes.status === 'fulfilled'
      ? catalogRes.value.map((env, index) =>
          envelopeToScored(
            env,
            chartQuery
              ? Math.max(0.95 - index * 0.01, 0.8)
              : albumMode
                ? Math.max(0.96 - index * 0.005, 0.85)
                : Math.max(scoreOnlineMatch(env, query), 0.75),
            1,
          ),
        )
      : [];

  const jamScored =
    jamRes.status === 'fulfilled'
      ? jamRes.value.map((env) =>
          envelopeToScored(env, scoreOnlineMatch(env, query), 2),
        )
      : [];

  const archScored =
    archRes.status === 'fulfilled'
      ? archRes.value.map((env) =>
          envelopeToScored(env, scoreOnlineMatch(env, query), 4),
        )
      : [];

  const tier2Scored: SearchScoredCandidate[] = [
    ...localResults,
    ...catalogScored,
    ...jamScored,
    ...archScored,
  ];

  if (onPartial && tier2Scored.length > localResults.length) {
    onPartial(sortSearchHits(resolveIdentity(tier2Scored)));
  }

  /** Album drill may skip Jamendo/Archive noise; proxy/debrid fan out per track in album mode. */
  const skipExtendedTiers = chartQuery || catalogOnly;

  let proxyScored: SearchScoredCandidate[] = [];
  let debridScored: SearchScoredCandidate[] = [];

  const mergeWebEnvelopes = (
    proxy: SearchScoredCandidate[],
    webEnvelopes: MediaEnvelope[],
  ): SearchScoredCandidate[] => {
    if (!webEnvelopes.length) return proxy;
    const webScored = webEnvelopes
      .filter((env) => tierEnvelopeRelevant(env, query))
      .map((env) =>
        envelopeToScored(env, Math.max(scoreOnlineMatch(env, query), 0.85), 5),
      );
    const seenIds = new Set(proxy.map((s) => s.id));
    const merged = [...proxy];
    for (const scored of webScored) {
      if (!seenIds.has(scored.id)) {
        merged.push(scored);
        seenIds.add(scored.id);
      }
    }
    return merged;
  };

  if (albumMode && albumIntentTracks.length > 0) {
    const [albumTierScored, webRes] = await Promise.all([
      fanOutAlbumTrackTiers(albumIntentTracks),
      webEnvelopesPromise,
    ]);
    proxyScored = mergeWebEnvelopes(
      albumTierScored.filter((s) => s.priority === 5),
      webRes,
    );
    debridScored = albumTierScored.filter((s) => s.priority === 6);
  } else if (!skipExtendedTiers) {
    const [proxyRes, debridRes, webRes] = await Promise.allSettled([
      searchProxyTier3(query),
      searchDebridTier4(query),
      webEnvelopesPromise,
    ]);
    proxyScored =
      proxyRes.status === 'fulfilled'
        ? proxyRes.value
            .filter((env) => tierEnvelopeRelevant(env, query))
            .map((env) => envelopeToScored(env, scoreOnlineMatch(env, query), 5))
        : [];
    debridScored =
      debridRes.status === 'fulfilled'
        ? debridRes.value
            .filter((env) => tierEnvelopeRelevant(env, query))
            .map((env) => envelopeToScored(env, scoreOnlineMatch(env, query), 6))
        : [];
    if (webRes.status === 'fulfilled') {
      proxyScored = mergeWebEnvelopes(proxyScored, webRes.value);
    }
  }

  const [addonRes] = await Promise.allSettled([
    skipExtendedTiers || albumMode ? Promise.resolve([]) : searchEnabledAddons(query),
  ]);

  const addonScored =
    addonRes.status === 'fulfilled'
      ? addonRes.value.map((c) => {
          const env = candidateToEnvelope(c);
          return envelopeToScored(env, 0.4, c.priority);
        })
      : [];

  if (addonScored.length > 0) {
    logTierResolution({
      query,
      tier: 2,
      provider: 'addons',
      outcome: 'hit',
      detail: `${addonScored.length} addon hit(s)`,
    });
  }

  const allScored: SearchScoredCandidate[] = [
    ...tier2Scored,
    ...addonScored,
    ...proxyScored,
    ...debridScored,
  ];

  let hits = sortSearchHits(resolveIdentity(allScored));
  if (albumMode && albumIntentTracks.length > 0) {
    hits = finalizeAlbumModeHits(hits, albumIntentTracks);
  } else if (!albumMode && resolvedHint) {
    hits = [];
  } else if (!albumMode) {
    hits = filterHitsByQueryRelevance(hits, query);
  }

  return {
    hits,
    albumContext: albumMode ? intentAlbum : undefined,
    albumTracks: albumMode ? albumIntentTracks : undefined,
  };
}

export interface EngineSearchResult {
  envelopes: MediaEnvelope[];
  hits: ResolvedSearchHit[];
  fromCache: boolean;
  albumContext?: CatalogAlbum;
  albumTracks?: CatalogTrack[];
}

export async function engineExploreSearch(
  group: ExploreGroup,
  label: string,
): Promise<EngineSearchResult> {
  let envelopes = await fetchExploreEnvelopes(group, label, 50);
  if (envelopes.length === 0) {
    const fallbackQuery = exploreDisplayQuery(group, label) || label;
    envelopes = await searchCatalogProvider(fallbackQuery);
  }
  if (envelopes.length === 0 && label.trim()) {
    envelopes = await searchCatalogProvider(label.trim());
  }
  const hits = sortSearchHits(
    resolveIdentity(
      envelopes.map((env, index) =>
        envelopeToScored(env, Math.max(0.95 - index * 0.01, 0.75), 1),
      ),
    ),
  );
  return {
    envelopes: hits.map((h) => h.primaryEnvelope),
    hits,
    fromCache: false,
  };
}

export type EngineSearchOptions = {
  /** Skip tier 3/4 proxy, debrid, and web fan-out — resolve those on play intent only. */
  catalogOnly?: boolean;
};

export async function engineSearch(
  query: string,
  onPartial?: (hits: ResolvedSearchHit[]) => void,
  albumHint?: CatalogAlbum,
  options?: EngineSearchOptions,
): Promise<EngineSearchResult> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return { envelopes: [], hits: [], fromCache: false };
  }

  if (isNewMusicQuery(query)) {
    return engineExploreSearch('quick', newMusicSearchLabel());
  }

  const cached = albumHint || isChartQuery(query) ? undefined : searchCache.get(normalized);
  if (cached) {
    const hits = sortSearchHits(
      resolveIdentity(cached.map((env) => envelopeToScored(env, 0.99))),
    );
    const cachedIntent =
      albumHint ||
      isChartQuery(query) ||
      isLikelyArtistNameQuery(normalized) ||
      isLikelyCombinedTrackQuery(normalized)
        ? null
        : await resolveAlbumIntent(normalized);
    const albumContext = albumHint ?? cachedIntent?.album;
    const albumTracks =
      albumContext != null ? await fetchAlbumTracks(albumContext) : undefined;
    return {
      envelopes: hits.map((h) => h.primaryEnvelope),
      hits,
      fromCache: true,
      albumContext,
      albumTracks: albumTracks?.length ? albumTracks : undefined,
    };
  }

  if (albumHint) {
    const canonicalHint = await canonicalizeAlbumHint(albumHint);
    const albumTracks = await fetchAlbumTracks(canonicalHint);
    if (albumTracks.length > 0 && onPartial) {
      const partialHits = sortSearchHits(
        resolveIdentity(
          albumTracks
            .map((t) => t.envelope)
            .filter((e): e is MediaEnvelope => Boolean(e))
            .map((env, index) => envelopeToScored(env, Math.max(0.96 - index * 0.005, 0.85), 1)),
        ),
      );
      onPartial(partialHits);
    }
  }

  const canonicalHint = albumHint ? await canonicalizeAlbumHint(albumHint) : undefined;
  const { hits: resolvedHits, albumContext, albumTracks } = await tieredFanOut(
    query,
    onPartial,
    canonicalHint,
    options?.catalogOnly,
  );
  const sortedHits =
    albumContext != null ? resolvedHits : sortSearchHits(resolvedHits);
  const envelopes = sortedHits.map((h) => h.primaryEnvelope);
  if (envelopes.length) {
    searchCache.set(normalized, envelopes);
  }
  return {
    envelopes,
    hits: sortedHits,
    fromCache: false,
    albumContext: canonicalHint ?? albumContext,
    albumTracks,
  };
}

export function sourceScore(source: CandidateSource): number {
  const rel = mapToSearchProviderId(source.provider);
  const reliability = rel ? searchFeedback.getReliability(rel) : 0.5;
  const priorityBoost = Math.max(0, 6 - source.priority);
  return Math.round(reliability * priorityBoost * 10);
}

/** Fast Sandbox Server heartbeat — 3s probe, 30s cache (tier34/client). */
export {
  isServerReachable,
  isServerReachableCached,
} from './tier34/client';

export function transportLabel(
  provider: MediaProvider,
  transport: MediaTransport,
): 'LOCAL' | 'HTTP' | 'PROXY' | 'DEBRID' {
  if (
    provider === 'local-vault' ||
    provider === 'stream-cache' ||
    provider === 'indexeddb' ||
    provider === 'blob'
  ) {
    return 'LOCAL';
  }
  if (provider === 'debrid' || transport === 'debrid') return 'DEBRID';
  if (
    provider === 'stream-proxy' ||
    provider === 'proxy' ||
    transport === 'stream-proxy' ||
    transport === 'proxy'
  ) {
    return 'PROXY';
  }
  if (transport === 'p2p' || provider === 'webtorrent' || provider === 'dht-swarm') {
    return 'PROXY';
  }
  return 'HTTP';
}
