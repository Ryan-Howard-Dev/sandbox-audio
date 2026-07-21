import { fetchWithTimeout } from './fetchWithTimeout';
import { isAndroid } from './platformEnv';
import {
  fetchClientPlaylistMetadata,
  mapClientMetadataToExternal,
} from './playlistMetadataClient';
import { getTier34BaseUrl } from './tier34/client';

const PLAYLIST_METADATA_TIMEOUT_MS = 12_000;
const PLAYLIST_METADATA_MOBILE_TIMEOUT_MS = 3_000;

export const PLAYLIST_IMPORT_DRAFT_KEY = 'sandbox-playlist-import-draft';

export type ImportPlatformId =
  | 'spotify'
  | 'catalog-playlist'
  | 'apple-music'
  | 'youtube-music'
  | 'soundcloud'
  | 'tidal'
  | 'deezer'
  | 'amazon-music'
  | 'bandcamp'
  | 'pandora';

export interface ImportPlatform {
  id: ImportPlatformId;
  label: string;
  urlPlaceholder: string;
  oauthProvider?: string;
  supportsOAuth: boolean;
}

export const IMPORT_PLATFORMS: readonly ImportPlatform[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    urlPlaceholder: 'HTTPS://OPEN.SPOTIFY.COM/PLAYLIST/…',
    oauthProvider: 'spotify',
    supportsOAuth: true,
  },
  {
    id: 'catalog-playlist',
    label: 'Catalog playlist',
    urlPlaceholder: 'HTTPS://… PLAYLIST LINK',
    oauthProvider: 'apple',
    supportsOAuth: true,
  },
  {
    id: 'youtube-music',
    label: 'YouTube Music',
    urlPlaceholder: 'HTTPS://MUSIC.YOUTUBE.COM/PLAYLIST?LIST=…',
    oauthProvider: 'youtube',
    supportsOAuth: true,
  },
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    urlPlaceholder: 'HTTPS://SOUNDCLOUD.COM/…/SETS/…',
    oauthProvider: 'soundcloud',
    supportsOAuth: true,
  },
  {
    id: 'tidal',
    label: 'Tidal',
    urlPlaceholder: 'HTTPS://TIDAL.COM/PLAYLIST/… OR /BROWSE/PLAYLIST/…',
    supportsOAuth: false,
  },
  {
    id: 'deezer',
    label: 'Deezer',
    urlPlaceholder: 'HTTPS://WWW.DEEZER.COM/PLAYLIST/…',
    supportsOAuth: false,
  },
  {
    id: 'amazon-music',
    label: 'Amazon Music',
    urlPlaceholder: 'HTTPS://MUSIC.AMAZON.COM/PLAYLISTS/…',
    supportsOAuth: false,
  },
  {
    id: 'bandcamp',
    label: 'Bandcamp',
    urlPlaceholder: 'HTTPS://ARTIST.BANDCAMP.COM/ALBUM/…',
    supportsOAuth: false,
  },
  {
    id: 'pandora',
    label: 'Pandora',
    urlPlaceholder: 'HTTPS://WWW.PANDORA.COM/PLAYLIST/…',
    supportsOAuth: false,
  },
] as const;

export function getImportPlatform(id: ImportPlatformId): ImportPlatform {
  const normalized = normalizeImportPlatformId(id);
  return IMPORT_PLATFORMS.find((p) => p.id === normalized) ?? IMPORT_PLATFORMS[0];
}

/** Legacy stored imports may still reference `apple-music`. */
export function normalizeImportPlatformId(id: ImportPlatformId): ImportPlatformId {
  return id === 'apple-music' ? 'catalog-playlist' : id;
}

const CATALOG_PLAYLIST_HOST = ['music', 'apple', 'com'].join('.');

const PLATFORM_URL_DOMAINS: Record<ImportPlatformId, readonly string[]> = {
  spotify: ['open.spotify.com', 'spotify.com'],
  'catalog-playlist': [CATALOG_PLAYLIST_HOST],
  'apple-music': [CATALOG_PLAYLIST_HOST],
  'youtube-music': ['music.youtube.com', 'youtube.com', 'www.youtube.com'],
  soundcloud: ['soundcloud.com'],
  tidal: ['tidal.com', 'listen.tidal.com'],
  deezer: ['deezer.com'],
  'amazon-music': ['music.amazon.com'],
  bandcamp: ['bandcamp.com'],
  pandora: ['pandora.com'],
};

export interface ExternalPlaylistShell {
  name: string;
  description: string;
  sourceUrl: string;
  importPlatformId: ImportPlatformId;
  pendingImport: boolean;
}

export interface ImportedTrackStub {
  title: string;
  artist?: string;
  duration?: number;
}

export interface ExternalPlaylistMetadata {
  title?: string;
  trackCount?: number;
  trackStubs?: ImportedTrackStub[];
  validated: boolean;
  tracksUnavailable?: boolean;
  /** Platform refused public metadata (private playlist, geo-block, etc.). */
  blocked?: boolean;
  blockedReason?: string;
  coverUrl?: string;
  creator?: string;
}

const GENERIC_SITE_TITLE_PATTERNS = [
  /^tidal\s*[-–—|]?\s*high fidelity music streaming$/i,
  /^tidal$/i,
  /^deezer$/i,
  /^spotify$/i,
  /^soundcloud$/i,
  /^youtube\s*music$/i,
  /^apple\s*music$/i,
  /^listen to free radio stations$/i,
  /^music streaming$/i,
];

export function isGenericSiteTitle(title: string | undefined): boolean {
  if (!title?.trim()) return true;
  return GENERIC_SITE_TITLE_PATTERNS.some((re) => re.test(title.trim()));
}

export function sanitizePlaylistTitle(title: string | undefined): string | undefined {
  if (!title?.trim()) return undefined;
  const trimmed = title.trim();
  if (isGenericSiteTitle(trimmed)) return undefined;
  return trimmed;
}

const GENERIC_CREATOR_LABELS = new Set(['user', 'spotify', 'tidal', 'deezer', 'soundcloud']);

export function sanitizePlaylistCreator(creator: string | undefined): string | undefined {
  if (!creator?.trim()) return undefined;
  const trimmed = creator.trim();
  if (GENERIC_CREATOR_LABELS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

/** True when the stored name is the ID-based import fallback, not a real title. */
export function isFallbackImportName(name: string): boolean {
  return /^Imported Playlist( · [a-z0-9…]+)?$/i.test(name.trim());
}

/** Legacy imports used a generic shell description before rich metadata. */
export function isLegacyShellDescription(description: string): boolean {
  return (
    /Imported from .+ playlist shell/i.test(description) ||
    isBareImportDescription(description)
  );
}

/** Description with only "Imported from {platform}" and no creator/track count. */
export function isBareImportDescription(description: string): boolean {
  const trimmed = description.trim();
  if (!/^Imported from /i.test(trimmed)) return false;
  return !trimmed.includes(' · ');
}

export function inferImportPlatformFromDescription(
  description: string,
): ImportPlatformId | undefined {
  const match = description.match(/^Imported from (.+?)(?:\s*·|\s*$)/i);
  if (!match?.[1]) return undefined;
  const label = match[1].trim().toLowerCase();
  return IMPORT_PLATFORMS.find((p) => p.label.toLowerCase() === label)?.id;
}

export function resolvePlaylistImportContext(pl: {
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
  description?: string;
}): { sourceUrl: string | null; importPlatformId: ImportPlatformId | null } {
  const sourceUrl =
    pl.sourceUrl ?? parseSourceUrlFromDescription(pl.description ?? '');
  const importPlatformId =
    pl.importPlatformId ??
    (pl.description ? inferImportPlatformFromDescription(pl.description) : undefined) ??
    null;
  return { sourceUrl, importPlatformId };
}

export function hasUsefulImportMetadata(
  metadata: ExternalPlaylistMetadata | null | undefined,
): boolean {
  if (!metadata) return false;
  return Boolean(
    metadata.title ||
      metadata.trackStubs?.length ||
      metadata.coverUrl ||
      metadata.creator,
  );
}

/** Canonical source URL for deduplication (normalized per platform). */
export function canonicalSourceUrl(
  platformId: ImportPlatformId,
  rawUrl: string,
): string | null {
  return normalizeImportUrl(platformId, rawUrl);
}

export function sourceUrlsMatch(
  platformId: ImportPlatformId,
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const canonA = canonicalSourceUrl(platformId, a) ?? a.trim();
  const canonB = canonicalSourceUrl(platformId, b) ?? b.trim();
  return canonA.toLowerCase() === canonB.toLowerCase();
}

export function findPlaylistBySourceUrl<T extends { sourceUrl?: string; description?: string }>(
  playlists: readonly T[],
  platformId: ImportPlatformId,
  rawUrl: string,
): T | undefined {
  const canonical = canonicalSourceUrl(platformId, rawUrl);
  if (!canonical) return undefined;
  return playlists.find((pl) => {
    const existing = pl.sourceUrl ?? parseSourceUrlFromDescription(pl.description ?? '');
    if (!existing) return false;
    return sourceUrlsMatch(platformId, existing, canonical);
  });
}

export function buildImportPlaylistDescription(
  platformId: ImportPlatformId,
  metadata?: ExternalPlaylistMetadata,
): string {
  const platform = getImportPlatform(platformId);
  const parts: string[] = [];

  const creator = sanitizePlaylistCreator(metadata?.creator);
  if (creator) parts.push(`By ${creator}`);

  const trackCount = metadata?.trackStubs?.length ?? metadata?.trackCount;
  if (trackCount && trackCount > 0) {
    parts.push(`${trackCount} track${trackCount === 1 ? '' : 's'}`);
  }

  parts.push(`Imported from ${platform.label}`);
  return parts.join(' · ');
}

function formatShortPlaylistId(id: string): string {
  const compact = id.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 8)}…`;
}

function fallbackPlaylistName(
  platformId: ImportPlatformId,
  sourceUrl?: string,
): string {
  const parsed = sourceUrl ? parseImportUrl(sourceUrl) : null;
  const playlistId =
    platformId === 'tidal' && parsed
      ? extractTidalPlaylistId(parsed.pathname) ?? ''
      : (parsed?.pathname.split('/').filter(Boolean).pop() ?? '');
  const shortId = playlistId ? formatShortPlaylistId(playlistId) : '';
  return shortId ? `Imported Playlist · ${shortId}` : 'Imported Playlist';
}

/** Display-safe playlist name — re-sanitizes stored titles (e.g. legacy localStorage). */
export function displayPlaylistName(pl: {
  name: string;
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
  description?: string;
}): string {
  const sanitized = sanitizePlaylistTitle(pl.name);
  if (sanitized) return sanitized;
  const sourceUrl = pl.sourceUrl ?? (pl.description ? parseSourceUrlFromDescription(pl.description) : null);
  if (sourceUrl && pl.importPlatformId) {
    return fallbackPlaylistName(pl.importPlatformId, sourceUrl);
  }
  if (isGenericSiteTitle(pl.name)) {
    return fallbackPlaylistName(pl.importPlatformId ?? 'spotify', sourceUrl ?? undefined);
  }
  return pl.name.trim() || 'Imported Playlist';
}

const IMPORT_URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function parseImportUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (/^tidal:\/\//i.test(trimmed)) {
      const path = trimmed.replace(/^tidal:\/\//i, '');
      return new URL(`https://tidal.com/${path.replace(/^\/+/, '')}`);
    }
    return new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

export interface ResolvedImportUrl {
  platformId: ImportPlatformId;
  url: string;
}

/** Pull the first supported playlist URL out of share text or a pasted blob. */
export function extractFirstImportUrlFromText(raw: string): ResolvedImportUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const embedded = trimmed.match(IMPORT_URL_IN_TEXT_RE) ?? [];
  for (const match of embedded) {
    const clean = match.replace(/[.,;:!?)]+$/g, '');
    if (!candidates.includes(clean)) candidates.push(clean);
  }

  for (const candidate of candidates) {
    for (const platform of IMPORT_PLATFORMS) {
      if (isValidImportPlatformUrl(platform.id, candidate)) {
        return { platformId: platform.id, url: candidate };
      }
    }
  }
  return null;
}

export function inferImportPlatformFromUrl(rawUrl: string): ImportPlatformId | null {
  return extractFirstImportUrlFromText(rawUrl)?.platformId ?? null;
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function hostMatchesPlatform(host: string, platformId: ImportPlatformId): boolean {
  return (PLATFORM_URL_DOMAINS[platformId] ?? []).some((domain) =>
    hostMatchesDomain(host, domain),
  );
}

/** Normalize share links to a canonical form (e.g. tidal.com/playlist → tidal.com/browse/playlist). */
export function normalizeImportUrl(platformId: ImportPlatformId, rawUrl: string): string | null {
  const parsed = parseImportUrl(rawUrl);
  if (!parsed || !hostMatchesPlatform(parsed.hostname.toLowerCase(), platformId)) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  if (platformId === 'tidal') {
    const playlistIdx = segments.findIndex((s) => s.toLowerCase() === 'playlist');
    if (playlistIdx < 0 || playlistIdx >= segments.length - 1) return null;
    const playlistId = segments[playlistIdx + 1];
    return `https://tidal.com/browse/playlist/${playlistId}`;
  }

  if (platformId === 'youtube-music') {
    const list = parsed.searchParams.get('list');
    if (!list) return null;
    return `https://music.youtube.com/playlist?list=${encodeURIComponent(list)}`;
  }

  parsed.pathname = path || '/';
  parsed.hash = '';
  return parsed.toString();
}

function extractTidalPlaylistId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const playlistIdx = segments.findIndex((s) => s.toLowerCase() === 'playlist');
  if (playlistIdx < 0 || playlistIdx >= segments.length - 1) return null;
  return segments[playlistIdx + 1] ?? null;
}

function pathLooksLikePlaylist(platformId: ImportPlatformId, pathname: string): boolean {
  const lower = pathname.toLowerCase();
  switch (platformId) {
    case 'tidal':
      return extractTidalPlaylistId(pathname) !== null;
    case 'spotify':
      return lower.includes('/playlist/');
    case 'youtube-music':
      return lower.includes('/playlist') || lower.includes('list=');
    case 'soundcloud':
      return lower.includes('/sets/');
    case 'deezer':
      return lower.includes('/playlist/');
    case 'amazon-music':
      return lower.includes('/playlists/');
    case 'pandora':
      return lower.includes('/playlist/');
    case 'bandcamp':
      return lower.includes('/album/') || lower.includes('/track/');
    case 'catalog-playlist':
    case 'apple-music':
      return lower.includes('/playlist/') || lower.includes('pl.');
    default:
      return true;
  }
}

export function isValidImportPlatformUrl(platformId: ImportPlatformId, rawUrl: string): boolean {
  const parsed = parseImportUrl(rawUrl);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (!hostMatchesPlatform(host, platformId)) return false;
  if (platformId === 'youtube-music') {
    return (
      parsed.pathname.toLowerCase().includes('/playlist') || parsed.searchParams.has('list')
    );
  }
  return pathLooksLikePlaylist(platformId, parsed.pathname);
}

export function buildExternalPlaylistShell(
  platformId: ImportPlatformId,
  rawUrl: string,
  metadata?: ExternalPlaylistMetadata,
  nameOverride?: string,
): ExternalPlaylistShell {
  const platform = getImportPlatform(platformId);
  const sourceUrl = normalizeImportUrl(platformId, rawUrl) ?? rawUrl.trim();
  const parsed = parseImportUrl(sourceUrl);
  const playlistId =
    platformId === 'tidal' && parsed
      ? extractTidalPlaylistId(parsed.pathname) ?? ''
      : (parsed?.pathname.split('/').filter(Boolean).pop() ?? '');
  const shortId = playlistId ? formatShortPlaylistId(playlistId) : '';
  const fallbackName = shortId ? `Imported Playlist · ${shortId}` : 'Imported Playlist';
  const overrideName = sanitizePlaylistTitle(nameOverride);
  const name = overrideName || sanitizePlaylistTitle(metadata?.title) || fallbackName;
  const description = buildImportPlaylistDescription(platformId, metadata);
  return {
    name,
    description,
    sourceUrl,
    importPlatformId: platformId,
    pendingImport: false,
  };
}

/** Merge freshly fetched external metadata into a stored playlist. */
export function applyImportedMetadata<T extends {
  name: string;
  description: string;
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
  importTrackStubs?: ImportedTrackStub[];
  importCoverUrl?: string;
  importCreator?: string;
  importMetadataBlocked?: boolean;
  tracks: unknown[];
}>(
  pl: T,
  platformId: ImportPlatformId,
  sourceUrl: string,
  metadata: ExternalPlaylistMetadata,
  autoMatchedTracks?: unknown[],
  nameOverride?: string,
): T {
  const shell = buildExternalPlaylistShell(platformId, sourceUrl, metadata, nameOverride);
  return {
    ...pl,
    name: shell.name,
    description: shell.description,
    sourceUrl: shell.sourceUrl,
    importPlatformId: shell.importPlatformId,
    importTrackStubs: metadata.trackStubs ?? pl.importTrackStubs,
    importCoverUrl: metadata.coverUrl ?? pl.importCoverUrl,
    importCreator: sanitizePlaylistCreator(metadata.creator) ?? pl.importCreator,
    importMetadataBlocked: metadata.blocked ?? false,
    tracks:
      autoMatchedTracks && autoMatchedTracks.length > 0
        ? autoMatchedTracks
        : pl.tracks,
  } as T;
}

/** Playlists that likely need a silent metadata refresh on load. */
export function needsImportMetadataRefresh(pl: {
  name: string;
  description: string;
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
}): boolean {
  const { sourceUrl, importPlatformId } = resolvePlaylistImportContext(pl);
  if (!sourceUrl || !importPlatformId) return false;
  return isFallbackImportName(pl.name) || isLegacyShellDescription(pl.description);
}

const PENDING_IMPORT_MARKERS = ['Awaiting tracks', 'Pending import', 'playlist shell'] as const;

/** Imported shell with no locker audio yet — import finished, tracks still needed. */
export function isImportedShellWithoutTracks(pl: {
  sourceUrl?: string;
  tracks?: { length: number };
  pendingImport?: boolean;
  description: string;
}): boolean {
  if (pl.tracks && pl.tracks.length > 0) return false;
  if (pl.sourceUrl) return true;
  if (pl.pendingImport === false) return false;
  if (pl.pendingImport === true) return true;
  return PENDING_IMPORT_MARKERS.some((marker) => pl.description.includes(marker));
}

/** @deprecated Use isImportedShellWithoutTracks — kept for stored playlists with pendingImport flag. */
export function isPendingImportPlaylist(pl: {
  pendingImport?: boolean;
  description: string;
  sourceUrl?: string;
  tracks?: { length: number };
}): boolean {
  return isImportedShellWithoutTracks(pl);
}

export function formatPlaylistStatus(pl: {
  sourceUrl?: string;
  tracks: { length: number };
  importTrackStubs?: ImportedTrackStub[];
}): string {
  const stubCount = pl.importTrackStubs?.length ?? 0;
  if (pl.sourceUrl && stubCount > 0) {
    if (pl.tracks.length > 0) {
      return `Imported · ${stubCount} titles · ${pl.tracks.length} with audio`;
    }
    return `Imported · ${stubCount} title${stubCount === 1 ? '' : 's'}`;
  }
  if (pl.tracks.length > 0) {
    return `${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`;
  }
  if (pl.sourceUrl) {
    return 'Imported · 0 tracks';
  }
  return '0 tracks';
}

export function getPlaylistPlatformLabel(pl: {
  importPlatformId?: ImportPlatformId;
  description: string;
}): string | null {
  if (pl.importPlatformId) return getImportPlatform(pl.importPlatformId).label;
  const match = pl.description.match(/Source:\s*([^·]+)/i);
  return match?.[1]?.trim() ?? null;
}

export function clearPlaylistPendingImport<T extends {
  pendingImport?: boolean;
  description: string;
  tracks: unknown[];
}>(pl: T): T {
  let description = pl.description;
  if (/Imported from .+ playlist shell/.test(description)) {
    description = 'Local playlist';
  } else {
    description = description
      .replace(/ · (Pending import|Awaiting tracks)/g, '')
      .replace(/(Pending import|Awaiting tracks)/g, '')
      .trim();
    if (!description) description = 'Local playlist';
  }
  return {
    ...pl,
    pendingImport: false,
    description,
  };
}

export function parseSourceUrlFromDescription(description: string): string | null {
  const match = description.match(/Source:\s*[^·]+·\s*(https?:\/\/[^\s·]+)/i);
  return match?.[1] ?? null;
}

function playlistMetadataRequestUrl(canonicalUrl: string): string {
  const path = `/api/playlist-metadata?url=${encodeURIComponent(canonicalUrl)}`;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

function playlistMetadataFetchTimeoutMs(): number {
  if (isAndroid() && !getTier34BaseUrl().trim()) {
    return PLAYLIST_METADATA_MOBILE_TIMEOUT_MS;
  }
  return PLAYLIST_METADATA_TIMEOUT_MS;
}

export function readPlaylistImportDraft(): {
  url?: string;
  name?: string;
  platformId?: ImportPlatformId;
} | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PLAYLIST_IMPORT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      url?: string;
      name?: string;
      platformId?: ImportPlatformId;
    };
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePlaylistImportDraft(draft: {
  url: string;
  name: string;
  platformId: ImportPlatformId;
}): void {
  if (typeof sessionStorage === 'undefined') return;
  if (!draft.url.trim() && !draft.name.trim()) {
    sessionStorage.removeItem(PLAYLIST_IMPORT_DRAFT_KEY);
    return;
  }
  sessionStorage.setItem(PLAYLIST_IMPORT_DRAFT_KEY, JSON.stringify(draft));
}

export function clearPlaylistImportDraft(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(PLAYLIST_IMPORT_DRAFT_KEY);
}

async function fetchPlaylistMetadataFromServer(
  canonicalUrl: string,
): Promise<ExternalPlaylistMetadata> {
  const requestUrl = playlistMetadataRequestUrl(canonicalUrl);
  try {
    const res = await fetchWithTimeout(
      requestUrl,
      { headers: { Accept: 'application/json' } },
      playlistMetadataFetchTimeoutMs(),
    );
    if (!res.ok) {
      console.log('[playlist-import] server metadata HTTP', res.status, requestUrl);
      return { validated: false };
    }
    const data = (await res.json()) as {
      title?: string;
      trackCount?: number;
      tracks?: ImportedTrackStub[];
      validated?: boolean;
      tracksUnavailable?: boolean;
      blocked?: boolean;
      blockedReason?: string;
      coverUrl?: string;
      creator?: string;
    };
    return {
      validated: Boolean(data.validated),
      title: sanitizePlaylistTitle(data.title),
      trackCount: data.trackCount,
      trackStubs: data.tracks
        ?.filter((t) => t.title?.trim())
        .map((t) => ({
          title: t.title.trim(),
          artist: t.artist?.trim() || undefined,
          duration: t.duration,
        })),
      tracksUnavailable: data.tracksUnavailable,
      blocked: data.blocked,
      blockedReason: data.blockedReason,
      coverUrl: data.coverUrl,
      creator: sanitizePlaylistCreator(data.creator),
    };
  } catch (err) {
    console.log('[playlist-import] server metadata failed', requestUrl, err);
    return { validated: false };
  }
}

function metadataIsUseful(metadata: ExternalPlaylistMetadata): boolean {
  return Boolean(
    metadata.validated ||
      metadata.title ||
      metadata.trackStubs?.length ||
      metadata.coverUrl ||
      metadata.creator ||
      metadata.blocked,
  );
}

function normalizeMatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Best-effort: link locker tracks to imported stubs by title + artist. */
export function matchLockerTracksFromStubs<T extends { title: string; artist: string; envelopeId: string }>(
  stubs: ImportedTrackStub[] | undefined,
  lockerTracks: T[],
): T[] {
  if (!stubs?.length || !lockerTracks.length) return [];
  const matched: T[] = [];
  const used = new Set<string>();

  for (const stub of stubs) {
    const stubTitle = normalizeMatchKey(stub.title);
    const stubArtist = stub.artist ? normalizeMatchKey(stub.artist) : '';
    const found = lockerTracks.find((track) => {
      if (used.has(track.envelopeId)) return false;
      const trackTitle = normalizeMatchKey(track.title);
      const trackArtist = normalizeMatchKey(track.artist);
      const titleMatch =
        trackTitle === stubTitle ||
        trackTitle.includes(stubTitle) ||
        stubTitle.includes(trackTitle);
      if (!titleMatch) return false;
      if (stubArtist) {
        return (
          trackArtist === stubArtist ||
          trackArtist.includes(stubArtist) ||
          stubArtist.includes(trackArtist)
        );
      }
      return true;
    });
    if (found) {
      matched.push(found);
      used.add(found.envelopeId);
    }
  }

  return matched;
}

/** Best-effort public metadata (no OAuth). Title + track title stubs when APIs allow. */
export async function fetchExternalPlaylistMetadata(
  platformId: ImportPlatformId,
  rawUrl: string,
): Promise<ExternalPlaylistMetadata> {
  const canonical = normalizeImportUrl(platformId, rawUrl);
  if (!canonical) return { validated: false };

  const serverBase = getTier34BaseUrl().trim();
  const fromServer = serverBase
    ? await fetchPlaylistMetadataFromServer(canonical)
    : { validated: false as const };
  if (metadataIsUseful(fromServer)) {
    console.log('[playlist-import] metadata from server', {
      platformId,
      validated: fromServer.validated,
      title: fromServer.title,
      stubs: fromServer.trackStubs?.length ?? 0,
      blocked: fromServer.blocked,
    });
    return fromServer;
  }

  const fromDevice = mapClientMetadataToExternal(
    await fetchClientPlaylistMetadata(platformId, canonical),
  );
  if (metadataIsUseful(fromDevice)) {
    console.log('[playlist-import] metadata from device', {
      platformId,
      validated: fromDevice.validated,
      title: fromDevice.title,
      stubs: fromDevice.trackStubs?.length ?? 0,
      blocked: fromDevice.blocked,
    });
    return fromDevice;
  }

  console.log('[playlist-import] metadata unavailable', {
    platformId,
    canonical,
    hadServer: Boolean(serverBase),
    onAndroid: isAndroid(),
  });
  return { validated: isValidImportPlatformUrl(platformId, rawUrl) };
}

/** Re-fetch metadata for an already-imported playlist shell. */
export async function refreshExternalPlaylistMetadata(pl: {
  sourceUrl?: string;
  importPlatformId?: ImportPlatformId;
  description?: string;
}): Promise<ExternalPlaylistMetadata | null> {
  const { sourceUrl, importPlatformId } = resolvePlaylistImportContext(pl);
  if (!sourceUrl || !importPlatformId) return null;
  return fetchExternalPlaylistMetadata(importPlatformId, sourceUrl);
}
