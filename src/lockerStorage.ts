/**
 * Local vault persistence (IndexedDB) for SANDBOX LOCKER station.
 *
 * CONTENT POLICY — locker rows and audio blobs are user-owned. The app must never
 * silently delete locker metadata or blobs on boot, vault load, playback, or sync
 * heal passes. Mass removal is only allowed from Settings → Repair Locker after the
 * user confirms Clean metadata-only.
 */
export const LOCKER_NEVER_AUTO_DELETE = true as const;

export type LockerReconcileOptions = {
  /** Strip false hasAudioBlob flags / hollow blobs — only after explicit user repair. */
  clearHollowRows?: boolean;
  /** Drop zero-byte blob-store keys — only after explicit user repair. */
  deleteEmptyBlobs?: boolean;
  /** Required when clearHollowRows or deleteEmptyBlobs is true — from Repair Locker confirm UI. */
  userConfirmed?: symbol;
  /** Skip warming every locker row into native Exo cache (defer to playback). */
  skipNativeWarm?: boolean;
};

export type LockerPlayabilityMode = 'fast' | 'full';

import { isBootUiInteractive } from './bootInteractivity';
import {
  featuredArtistsFromTrackTitle,
  proxiedArtworkUrl,
  isCatalogCdnUrl,
  isLastFmBrandingCoverUrl,
  sanitizeCoverArtUrl,
} from './displaySanitize';
import { lookupBundledTrackArtistLine } from './albumBundledCredits';
import { catalogArtworkUrl, useDirectMediaUpstream } from './catalogDirect';
import { extractEmbeddedCover } from './embeddedCover';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { MediaEnvelope } from './sandboxLayer1';
import { loadDeviceCapacity } from './sandboxSettings';
import { DEVICE_CAPACITY_OPTIONS, type DeviceCapacity } from './stations/theme';
import { isAndroid } from './platformEnv';
import { parseId3Position } from './lockerTrackOrder';
import {
  pickLockerAlbumCover,
  rememberKnownGoodAlbumArt,
  resolveLockerTrackThumbArt,
} from './albumArtCache';

export interface LockerEntry {
  id: string;
  title: string;
  artist: string;
  genre: string;
  durationSeconds: number;
  url: string;
  addedAt: number;
  albumName?: string;
  albumArt?: string;
  releaseYear?: string;
  albumArtist?: string;
  composer?: string;
  trackNumber?: number;
  discNumber?: number;
  discCount?: string;
  /** Album-level credits (comma-separated names). */
  performers?: string;
  producers?: string;
  engineers?: string;
  linerNotesUrl?: string;
  bookletUrl?: string;
  /** Serialized AlbumCreditsResult snapshot (JSON). */
  creditsJson?: string;
  /** Per-track credits from online enrichment. */
  trackPerformers?: string;
  trackProducers?: string;
  trackSoloists?: string;
  /** Locker-stored lyrics from metadata enrichment or sync. */
  lyrics?: string;
  /** ID3 TKEY initial key for harmonic mixing. */
  initialKey?: string;
  /** True only when IDB bytes or Android native cache exist — set at vault load. */
  offlineReady?: boolean;
  /** User edited title/artist/album via Edit info — auto-repair must never overwrite. */
  userMetadataLocked?: boolean;
}

const DB_NAME = 'SandboxMusicCoreDB';
const STORE_NAME = 'tracks';
const BLOB_STORE_NAME = 'track_blobs';
const DB_VERSION = 3;

/** Ephemeral Exo cache pointer — not a durable audio source after process restart. */
export function isLockerCacheContentUri(path: string): boolean {
  const trimmed = path?.trim() ?? '';
  return /^content:\/\//i.test(trimmed) && /\/locker\//i.test(trimmed);
}

/** Durable on-disk download path (yt-dlp file:// or absolute path). */
function isStableNativeAudioPath(path: string): boolean {
  const trimmed = path?.trim() ?? '';
  if (!trimmed || isLockerCacheContentUri(trimmed)) return false;
  if (/\/ytdlp-playback\//i.test(trimmed)) return false;
  if (/\/ytdlp-locker\//i.test(trimmed)) return false;
  return /^file:\/\//i.test(trimmed) || trimmed.startsWith('/');
}

/** Importable locker audio path — durable files or in-flight ytdlp-locker temps. */
function isImportableLockerNativePath(path: string): boolean {
  const trimmed = path?.trim() ?? '';
  if (!trimmed || isLockerCacheContentUri(trimmed)) return false;
  if (/\/ytdlp-locker\//i.test(trimmed)) return true;
  return isStableNativeAudioPath(trimmed);
}

export type LockerStorageUsage = {
  bytes: number;
  trackCount: number;
};

export class LockerCapacityExceededError extends Error {
  readonly limitBytes: number;
  readonly projectedBytes: number;

  constructor(limitBytes: number, projectedBytes: number) {
    super(
      `Locker capacity exceeded (${formatLockerMb(projectedBytes)} / ${formatLockerMb(limitBytes)} limit). Remove tracks or raise Device Capacity in Settings.`,
    );
    this.name = 'LockerCapacityExceededError';
    this.limitBytes = limitBytes;
    this.projectedBytes = projectedBytes;
  }
}

export function capacityLimitBytes(capacity?: DeviceCapacity): number | null {
  const cap = capacity ?? loadDeviceCapacity();
  if (cap === 'UNLIMITED') return null;
  const match = cap.match(/^(\d+)\s*GB$/i);
  if (!match) return null;
  return parseInt(match[1], 10) * 1024 * 1024 * 1024;
}

export function formatLockerMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function rowBlobBytes(row: {
  audioBlob?: Blob;
  albumArtBlob?: Blob;
}): number {
  let n = 0;
  if (row.audioBlob instanceof Blob) n += row.audioBlob.size;
  if (row.albumArtBlob instanceof Blob) n += row.albumArtBlob.size;
  return n;
}

export function capacityUsagePercent(usedBytes: number, capacity?: DeviceCapacity): number {
  const limit = capacityLimitBytes(capacity);
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((usedBytes / limit) * 1000) / 10);
}

export function formatCapacityLabel(capacity?: DeviceCapacity): string {
  const cap = capacity ?? loadDeviceCapacity();
  if ((DEVICE_CAPACITY_OPTIONS as readonly string[]).includes(cap)) return cap;
  return loadDeviceCapacity();
}

const AUDIO_EXT = /\.(mp3|flac|ogg|wav|m4a|opus|webm|aac)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif)$/i;

/** Cover URLs that survive reload (not session-only blob: strings). */
export function isPersistentAlbumArt(url?: string): boolean {
  const u = url?.trim();
  if (!u) return false;
  if (u.startsWith('blob:')) return false;
  if (isLastFmBrandingCoverUrl(u)) return false;
  return (
    u.startsWith('http://') ||
    u.startsWith('https://') ||
    u.startsWith('/coverart') ||
    u.startsWith('/cover-proxy') ||
    u.startsWith('/musicbrainz')
  );
}

function externalCoverNeedsProxy(url: string): boolean {
  if (!url.startsWith('https://')) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('mzstatic.com') ||
      host.endsWith('.theaudiodb.com') ||
      host === 'coverartarchive.org' ||
      host.endsWith('.coverartarchive.org')
    );
  } catch {
    return false;
  }
}

function coverProxyPath(url: string): string {
  if (useDirectMediaUpstream()) {
    if (isCatalogCdnUrl(url)) return catalogArtworkUrl(url) ?? url.trim();
    return url.trim();
  }
  return `/cover-proxy?url=${encodeURIComponent(url.trim())}`;
}

function resolveCoverFetchUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (useDirectMediaUpstream()) {
    if (isCatalogCdnUrl(trimmed)) return catalogArtworkUrl(trimmed) ?? trimmed;
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  }
  const proxied = proxiedArtworkUrl(trimmed);
  if (proxied) return proxied;
  if (externalCoverNeedsProxy(trimmed) && !useDirectMediaUpstream()) {
    return coverProxyPath(trimmed);
  }
  return trimmed;
}

function isStoredArtBlob(value: unknown): value is Blob {
  if (value instanceof Blob || value instanceof File) return true;
  // Some IndexedDB implementations deserialize binary fields as ArrayBuffer.
  return value instanceof ArrayBuffer && value.byteLength > 0;
}

function storedArtToBlob(value: unknown): Blob | null {
  if (value instanceof Blob || value instanceof File) return value;
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Blob([value], { type: 'image/jpeg' });
  }
  return null;
}

/** Android WebView often deserializes IDB audio as ArrayBuffer instead of Blob. */
function sniffAudioMime(buffer: ArrayBuffer): string | undefined {
  if (buffer.byteLength < 4) return undefined;
  const view = new DataView(buffer);
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const b2 = view.getUint8(2);
  const b3 = view.getUint8(3);
  if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) return 'audio/flac';
  if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return 'audio/ogg';
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return 'audio/mpeg';
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return 'audio/mpeg';
  if (view.getUint32(0, false) === 0x66747970) return 'audio/mp4';
  return undefined;
}

function storedAudioToBlob(value: unknown): Blob | null {
  if (value instanceof Blob || value instanceof File) return value;
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Blob([value], { type: sniffAudioMime(value) ?? 'audio/mpeg' });
  }
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(bytes);
    return new Blob([copy], { type: sniffAudioMime(copy.buffer) ?? 'audio/mpeg' });
  }
  return null;
}

function resolveAlbumArtForRow(row: {
  albumArt?: string;
  albumArtBlob?: Blob;
}): string | undefined {
  const blob = storedArtToBlob(row.albumArtBlob);
  if (blob) {
    return URL.createObjectURL(blob);
  }
  if (isLastFmBrandingCoverUrl(row.albumArt)) return undefined;
  if (isPersistentAlbumArt(row.albumArt)) return row.albumArt!.trim();
  return undefined;
}

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'id' });
      }
      if (oldVersion > 0 && oldVersion < 3) {
        migrateTrackBlobsToDedicatedStore(request.transaction!);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type TrackBlobRow = {
  id: string;
  audioBlob?: Blob;
  albumArtBlob?: Blob;
};

/** Move inline blobs off the tracks store so metadata-only reads stay lightweight. */
function migrateTrackBlobsToDedicatedStore(tx: IDBTransaction): void {
  const tracks = tx.objectStore(STORE_NAME);
  const blobs = tx.objectStore(BLOB_STORE_NAME);
  const req = tracks.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    const row = cursor.value as LockerRow & { hasAudioBlob?: boolean };
    const audioBlob = storedAudioToBlob(row.audioBlob) ?? undefined;
    const albumArtBlob = storedArtToBlob(row.albumArtBlob) ?? undefined;
    if (audioBlob || albumArtBlob) {
      blobs.put({
        id: row.id,
        ...(audioBlob ? { audioBlob } : {}),
        ...(albumArtBlob ? { albumArtBlob } : {}),
      } satisfies TrackBlobRow);
      delete row.audioBlob;
      delete row.albumArtBlob;
      row.hasAudioBlob = Boolean(audioBlob);
      cursor.update(row);
    }
    cursor.continue();
  };
}

function putTrackRowWithBlobs(
  tracks: IDBObjectStore,
  blobs: IDBObjectStore,
  row: Record<string, unknown>,
): void {
  const audioBlob = storedAudioToBlob(row.audioBlob) ?? undefined;
  const albumArtBlob = storedArtToBlob(row.albumArtBlob) ?? undefined;
  const meta = { ...row };
  if (audioBlob || albumArtBlob) {
    blobs.put({
      id: String(row.id),
      ...(audioBlob ? { audioBlob } : {}),
      ...(albumArtBlob ? { albumArtBlob } : {}),
    } satisfies TrackBlobRow);
    delete meta.audioBlob;
    delete meta.albumArtBlob;
    meta.hasAudioBlob = Boolean(audioBlob);
  }
  tracks.put(meta);
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

const PLACEHOLDER_ARTIST =
  /^(local upload|unknown artist|sandbox artist|uploaded|local device locker)$/i;

/** Junk artist tags from YMusic, folder rips, and bad MediaStore metadata. */
const BAD_MEDIA_ARTIST_RE =
  /^(?:digital[\s_-]?jockey|ymusic|jonjeffjon(?:\s+edits)?|unknown|various\s+artists?|<unknown>|music|audio|download|android)$/i;

/** Fan-compile / playlist folder names that are not real album titles. */
const JUNK_IMPORT_ALBUM_RE =
  /\b(?:archive|playlist|ymusic|fan\s*(?:made|edit)|reupload|leak|bootleg|unofficial|edits?)\b/i;

/** True when Android MediaStore / YMusic tags are not real performer names. */
export function isBadMediaStoreArtist(name?: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (PLACEHOLDER_ARTIST.test(n)) return true;
  if (BAD_MEDIA_ARTIST_RE.test(n)) return true;
  if (/ymusic/i.test(n)) return true;
  if (/jonjeffjon/i.test(n)) return true;
  if (isJunkImportArchiveLabel(n)) return true;
  return false;
}

/** YMusic playlist folders and fan-compile names — not real release titles. */
export function isBadMediaStoreAlbum(name?: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (/^ymusic$/i.test(n)) return true;
  if (/ymusic/i.test(n)) return true;
  if (JUNK_IMPORT_ALBUM_RE.test(n)) return true;
  if (isJunkImportArchiveLabel(n)) return true;
  if (isBadMediaStoreArtist(n)) return true;
  return false;
}

export type StubArtistContext = Partial<Pick<LockerEntry, 'title' | 'albumName' | 'albumArtist' | 'artist'>>;

/** Single-word / fan-compile names that YMusic playlist folders use as fake TPE1/TPE2 tags. */
const KNOWN_PLAYLIST_STUB_ARTIST_KEYS = new Set([
  'donda',
  'ultra',
  'cole',
  'coyote',
  'shell',
  'black flag',
  'beauty and the',
  'beauty and the beast',
  'mr miyagi',
  'redrum',
  'like',
  'bad',
  'type',
  'dance',
  'all',
  'fuk',
  'bloody',
  'california',
  'looove',
  'at the',
  'dream come',
  'no limit',
  'show',
  'show of',
  'surround',
  'preacher',
  'til further notice',
  'either on or',
  'scaring the',
  'games',
  'party',
  'him',
  'poetry',
  'n95',
  'no more',
  'will make you',
]);

/**
 * Wrong MusicBrainz/Discogs stub matches from low-confidence catalog repair.
 * Prefer Unknown Artist over these invented performers.
 */
const INVENTED_CATALOG_STUB_ARTIST_KEYS = new Set([
  'liv angell',
  'starringo',
  'ash wiseman',
  'hannah rae faulk',
  'ash wiseman hannah rae faulk',
  'niko sitaras',
  'will make you',
  'no more',
  'games',
  'ascend',
  'ascend to the fourth dimension',
  'groove ar',
  'groove arm',
]);

/** True when auto-repair invented a wrong catalog stub artist (not a real performer). */
export function isInventedCatalogStubArtistName(name: string | undefined): boolean {
  const key = normalizeLockerKeyPart((name ?? '').trim());
  if (!key) return false;
  if (INVENTED_CATALOG_STUB_ARTIST_KEYS.has(key)) return true;
  if (key.startsWith('groove ar')) return true;
  if (key.startsWith('ash wiseman')) return true;
  return false;
}

/** True when user manually fixed tags — all auto-repair paths must skip this row. */
export function isUserMetadataLocked(entry: Pick<LockerEntry, 'userMetadataLocked'>): boolean {
  return entry.userMetadataLocked === true;
}

/** True when a library artist label is a known playlist-folder stub (no track context needed). */
export function isKnownPlaylistStubArtistName(name: string | undefined): boolean {
  const key = normalizeLockerKeyPart((name ?? '').trim());
  if (!key) return true;
  if (KNOWN_PLAYLIST_STUB_ARTIST_KEYS.has(key)) return true;
  if (INVENTED_CATALOG_STUB_ARTIST_KEYS.has(key)) return true;
  if (/^beauty and the\b/.test(key)) return true;
  if (isTitleFragmentArtistName(name)) return true;
  if (isInventedCatalogStubArtistName(name)) return true;
  return false;
}

export type StubArtistReassignment = {
  artist: string;
  albumArtist: string;
  albumName?: string;
};

/** Remix/cover billing for N95 — default is Kendrick; narrow overrides only with explicit signals. */
function resolveN95RemixOrCoverContext(
  track: StubArtistContext,
): 'jeff-jons' | 'kanye' | null {
  const hay = [track.artist, track.albumArtist, track.albumName, track.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const artistKey = normalizeLockerKeyPart(track.artist ?? '');

  if (
    artistKey.includes('jeff') ||
    artistKey.includes('jons') ||
    artistKey.includes('jonjeff') ||
    /\bjeff\s*jons?\b/.test(hay) ||
    /\b(jeff|jons).{0,24}(remix|cover|version)\b/.test(hay) ||
    /\b(remix|cover|version).{0,24}(jeff|jons)\b/.test(hay)
  ) {
    return 'jeff-jons';
  }

  if (
    artistKey.includes('kanye') ||
    artistKey === 'ye' ||
    /\bkanye\s*west\b/.test(hay) ||
    (/\bye\b/.test(hay) && /\b(west|cover|remix|version)\b/.test(hay))
  ) {
    return 'kanye';
  }

  return null;
}

/**
 * Hardcoded title/artist → real performer mappings for common YMusic playlist stub tags.
 * Metadata-only — never removes or hides locker tracks.
 */
export function resolveKnownStubArtistReassignment(
  track: StubArtistContext,
): StubArtistReassignment | null {
  const title = (track.title ?? '').trim();
  const artist = (track.artist ?? '').trim();
  const titleKey = normalizeLockerKeyPart(title);
  const artistKey = normalizeLockerKeyPart(artist);

  if (
    titleKey === 'black flag' ||
    (artistKey === 'black flag' && titleKey.includes('black flag'))
  ) {
    return { artist: 'Denzel Curry', albumArtist: 'Denzel Curry' };
  }
  if (
    titleKey.includes('cole pimp') ||
    (artistKey === 'cole' && titleKey.includes('cole pimp'))
  ) {
    return { artist: 'Denzel Curry', albumArtist: 'Denzel Curry' };
  }
  if (
    titleKey === 'shxt' ||
    (artistKey === 'ultra' && (titleKey === 'shxt' || titleKey === 'ultra'))
  ) {
    return { artist: 'Denzel Curry', albumArtist: 'Denzel Curry' };
  }
  if (titleKey.includes('coyote') || artistKey === 'coyote') {
    return { artist: 'Ab-Soul', albumArtist: 'Ab-Soul' };
  }
  if (titleKey.includes('mr miyagi') || artistKey === 'donda') {
    return { artist: 'Kanye West', albumArtist: 'Kanye West' };
  }
  if (titleKey === 'redrum') {
    return { artist: '21 Savage', albumArtist: '21 Savage' };
  }
  if (titleKey === 'shell' || artistKey === 'shell') {
    return { artist: 'Kenny Mason', albumArtist: 'Kenny Mason' };
  }
  if (titleKey.includes('bloody waters')) {
    return {
      artist: 'Ab-Soul',
      albumArtist: 'Ab-Soul',
      albumName: 'Black Panther: The Album',
    };
  }
  if (titleKey === 'like that' || (artistKey === 'like' && titleKey.includes('like that'))) {
    return { artist: 'Future', albumArtist: 'Future' };
  }
  if (titleKey === 'looove' || artistKey === 'looove') {
    return { artist: 'Travis Scott', albumArtist: 'Travis Scott' };
  }
  if (titleKey === 'type shit' || (artistKey === 'type' && titleKey.includes('type shit'))) {
    return { artist: 'Future', albumArtist: 'Future' };
  }
  if (titleKey === 'no limit' || (titleKey.includes('no limit') && artistKey === 'no limit')) {
    return { artist: 'G-Eazy', albumArtist: 'G-Eazy' };
  }
  // Never invent ABBA / Taylor Swift / etc. from title-fragment artist tags alone.
  // Only map when the full known stub title matches exactly.
  if (titleKey === 'bad blood' && (artistKey === 'bad' || artistKey === 'bad blood' || !artistKey)) {
    return { artist: 'Taylor Swift', albumArtist: 'Taylor Swift' };
  }
  if (
    titleKey === 'at the river' &&
    (artistKey === 'at the' || artistKey === 'at the river' || !artistKey)
  ) {
    return { artist: 'Groove Armada', albumArtist: 'Groove Armada' };
  }
  if (
    titleKey === 'dance monkey' &&
    (artistKey === 'dance' || artistKey === 'dance monkey' || !artistKey)
  ) {
    return { artist: 'Tones and I', albumArtist: 'Tones and I' };
  }
  // Cover / release credits: Starburst is Danny Brown (not producer/uploader tags).
  if (titleKey === 'starburst' || titleKey.startsWith('starburst ')) {
    return { artist: 'Danny Brown', albumArtist: 'Danny Brown' };
  }
  // N95 — Kendrick Lamar (Mr. Morale). Jeff Jons / Kanye only when remix/cover tags say so.
  if (titleKey === 'n95' || titleKey.startsWith('n95 ')) {
    const remix = resolveN95RemixOrCoverContext(track);
    if (remix === 'jeff-jons') {
      return { artist: 'Jeff Jons', albumArtist: 'Jeff Jons' };
    }
    if (remix === 'kanye') {
      return { artist: 'Kanye West', albumArtist: 'Kanye West' };
    }
    return { artist: 'Kendrick Lamar', albumArtist: 'Kendrick Lamar' };
  }
  // Bittersweet / Poetry — Kanye West (YMusic title fragments).
  if (
    titleKey === 'poetry' ||
    titleKey === 'bittersweet' ||
    titleKey.includes('bittersweet poetry') ||
    titleKey.includes('bittersweet')
  ) {
    return {
      artist: 'Kanye West',
      albumArtist: 'Kanye West',
      albumName: 'Graduation',
    };
  }
  // HIM — Denzel Curry (not Starringo catalog stub).
  if (
    titleKey === 'him' &&
    (artistKey === 'starringo' || artistKey === 'him' || !artistKey || artistKey === 'him')
  ) {
    return { artist: 'Denzel Curry', albumArtist: 'Denzel Curry' };
  }
  // Party — Groove Armada when truncated stub tag.
  if (
    titleKey === 'party' &&
    (artistKey.startsWith('groove ar') || artistKey === 'party' || artistKey === 'groove arm')
  ) {
    return { artist: 'Groove Armada', albumArtist: 'Groove Armada' };
  }

  return null;
}

/**
 * True when playlist import / bad tags used an album or track title as the artist field
 * (e.g. Donda, Ultra, Cole, Shell, COYOTE, Black Flag on Tidal stub downloads).
 */
export function isMislabeledPlaylistStubArtist(
  name: string | undefined,
  context?: StubArtistContext,
): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;

  const key = normalizeLockerKeyPart(n);
  if (isKnownPlaylistStubArtistName(n)) {
    if (!context) return true;
  }
  if (isTitleFragmentArtistName(n, context)) return true;
  if (!context) return false;

  const title = context.title?.trim();
  if (title) {
    if (normalizeLockerKeyPart(title) === key) return true;
    const titlePrimary = albumPrimaryArtist(title);
    if (normalizeLockerKeyPart(titlePrimary) === key) return true;
    const firstWord = title.split(/\s+/)[0]?.trim();
    if (
      firstWord &&
      !n.includes(' ') &&
      normalizeLockerKeyPart(firstWord) === key &&
      firstWord.length <= 12
    ) {
      return true;
    }
    const titleWords = title.split(/\s+/).filter(Boolean);
    for (let len = 2; len <= Math.min(3, titleWords.length); len++) {
      const prefix = titleWords.slice(0, len).join(' ');
      if (!n.includes(' ') && normalizeLockerKeyPart(prefix) === key) return true;
      if (normalizeLockerKeyPart(prefix) === key && n.split(/\s+/).length <= len) return true;
    }
  }

  const album = context.albumName?.trim();
  if (album && normalizeLockerKeyPart(album) === key) return true;

  const trackArtist = context.artist?.trim();
  const albumArtist = context.albumArtist?.trim();
  if (
    album &&
    trackArtist &&
    normalizeLockerKeyPart(album) === normalizeLockerKeyPart(trackArtist) &&
    normalizeLockerKeyPart(album) === key
  ) {
    return true;
  }
  if (
    albumArtist &&
    album &&
    normalizeLockerKeyPart(albumArtist) === key &&
    normalizeLockerKeyPart(album) === key
  ) {
    return true;
  }

  return false;
}

/** "HOW? Kanye Archive" and similar fan-compile labels — never catalog artists. */
export function isJunkImportArchiveLabel(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/^how\?\s/i.test(n) && /\barchive\b/i.test(n)) return true;
  if (/\?\s*.+\barchive\b/i.test(n)) return true;
  if (/\barchive\b/i.test(n) && /\b(kanye|ye|west)\b/i.test(n)) return true;
  return false;
}

/** Single common words that must never be inferred as artist names. */
const WEAK_ARTIST_WORD =
  /^(the|a|an|my|our|your|his|her|its|new|old|best|live|deluxe|remaster(?:ed)?|at|no|all|bad|like|type|dance|fuk|bloody|california|looove|dream|come|limit|show|surround|preacher|til|further|notice|either|or|on|of|scaring|true|choices|bittersweet|poetry)$/i;

/** Title-prefix fragments YMusic/Tidal stubs use as fake TPE1 tags (never real artists). */
const KNOWN_TITLE_FRAGMENT_KEYS = new Set([
  'like',
  'like that',
  'bad',
  'bad blood',
  'type',
  'type shit',
  'dance',
  'dance monkey',
  'all',
  'all falls down',
  'fuk',
  'bloody',
  'california',
  'looove',
  'at the',
  'at the river',
  'dream come',
  'dream come true',
  'no limit',
  'beauty and the',
  'show',
  'show of',
  'surround',
  'preacher',
  'til further notice',
  'either on or',
  'scaring the',
  'kanye west bittersweet',
  'kanye west bittersweet poetry',
  'games',
  'party',
  'him',
  'poetry',
  'n95',
  'no more',
  'will make you',
  'ascend',
  'ascend to the fourth dimension',
  'king',
  'king of',
]);

/** Common English function/content words — multi-word phrases made only of these are never artists. */
const COMMON_ENGLISH_ARTIST_TOKEN =
  /^(?:the|a|an|and|or|of|on|at|to|for|in|my|our|your|his|her|its|new|old|best|live|all|bad|like|type|dance|show|surround|preacher|til|until|further|notice|either|scaring|dream|come|true|bloody|fuk|california|limit|no|bittersweet|poetry|choices|that|shit|monkey|falls|down|river|waters|blood)$/i;

/** Well-known performer prefixes used to detect "Artist + title fragment" mashups. */
const KNOWN_ARTIST_NAME_PREFIXES = [
  'kanye west',
  'taylor swift',
  'denzel curry',
  'travis scott',
  'childish gambino',
  '21 savage',
  'metro boomin',
  'future',
  'drake',
  'the weeknd',
  'abba',
];

/**
 * Uploader / channel handles (DinoA1, DIN0A1) — not catalog performers when used alone.
 */
export function isLikelyUploaderHandleArtist(name: string | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n || n.includes(' ')) return false;
  // Mixed letter+digit handles, or leetspeak channel IDs
  if (/^[A-Za-z]+\d+[A-Za-z0-9]*$/.test(n) && n.length <= 16) return true;
  if (/^[A-Za-z]*\d+[A-Za-z]+$/.test(n) && /\d/.test(n) && n.length <= 16) return true;
  if (/^[A-Z]{2,}\d+[A-Z0-9]*$/i.test(n) && /\d/.test(n) && n.length <= 14) return true;
  return false;
}

/**
 * Truncated display names like "Taylor Swi" that do not match a full vault consensus name.
 */
export function isTruncatedArtistName(
  name: string | undefined,
  vaultArtistKeys?: Set<string>,
): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const last = words[words.length - 1]!;
  // Last token looks cut off (3–4 letters, no vowel-ending surname pattern)
  if (last.length >= 3 && last.length <= 4 && !/^(jr|sr|ii|iii|iv)$/i.test(last)) {
    const key = normalizeLockerKeyPart(n);
    if (vaultArtistKeys?.has(key)) return false;
    // "Taylor Swi" — first word capitalized proper, last truncated
    if (/^[A-Z][a-z]+$/.test(words[0]!) && /^[A-Z][a-z]{2,3}$/.test(last)) {
      const longerExists = vaultArtistKeys
        ? [...vaultArtistKeys].some((k) => k.startsWith(key) && k.length > key.length)
        : false;
      if (longerExists) return true;
      // Without vault consensus, treat short trailing tokens as truncated
      if (last.length <= 3) return true;
    }
  }
  return false;
}

/** "Kanye West Bittersweet" — real artist name with song-title words glued on. */
export function isArtistTitleMashupName(name: string | undefined): boolean {
  const key = normalizeLockerKeyPart((name ?? '').trim());
  if (!key) return false;
  for (const prefix of KNOWN_ARTIST_NAME_PREFIXES) {
    if (key === prefix) return false;
    if (key.startsWith(`${prefix} `)) {
      const rest = key.slice(prefix.length).trim();
      if (!rest) return false;
      const restWords = rest.split(/\s+/).filter(Boolean);
      if (restWords.length >= 1 && restWords.every((w) => COMMON_ENGLISH_ARTIST_TOKEN.test(w) || w.length <= 12)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when a label is a song-title prefix / generic word, not a performer.
 * Used to block title-parse repair from creating fake library artists.
 */
export function isTitleFragmentArtistName(
  name: string | undefined,
  context?: StubArtistContext,
): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;

  const key = normalizeLockerKeyPart(n);
  if (KNOWN_TITLE_FRAGMENT_KEYS.has(key)) return true;
  if (WEAK_ARTIST_WORD.test(n)) return true;
  if (isArtistTitleMashupName(n)) return true;
  if (isLikelyUploaderHandleArtist(n)) return true;
  if (isTruncatedArtistName(n)) return true;
  if (isInventedCatalogStubArtistName(n)) return true;

  const words = n.split(/\s+/).filter(Boolean);
  if (words.length === 1 && WEAK_ARTIST_WORD.test(words[0]!)) return true;
  // Multi-word phrases composed entirely of common English tokens (At The, Show Of, Til Further Notice)
  if (words.length >= 2 && words.length <= 5 && words.every((w) => COMMON_ENGLISH_ARTIST_TOKEN.test(w))) {
    return true;
  }

  if (!context?.title?.trim()) return false;

  const title = context.title.trim();
  const titleKey = normalizeLockerKeyPart(title);
  if (titleKey === key) return true;
  if (titleKey.startsWith(`${key} `)) {
    if (words.length === 1 || KNOWN_TITLE_FRAGMENT_KEYS.has(key)) return true;
    if (words.length <= 4 && words.every((w) => COMMON_ENGLISH_ARTIST_TOKEN.test(w))) return true;
  }

  const titleWords = title.split(/\s+/).filter(Boolean);
  for (let len = 1; len <= Math.min(4, titleWords.length); len++) {
    const prefix = titleWords.slice(0, len).join(' ');
    if (normalizeLockerKeyPart(prefix) === key) {
      if (len === 1 || KNOWN_TITLE_FRAGMENT_KEYS.has(key)) return true;
      if (words.every((w) => COMMON_ENGLISH_ARTIST_TOKEN.test(w))) return true;
      // Multi-word title prefix only counts as fragment when mostly weak/common tokens
      const commonCount = words.filter((w) => COMMON_ENGLISH_ARTIST_TOKEN.test(w)).length;
      if (len >= 2 && commonCount >= Math.ceil(words.length * 0.6)) return true;
    }
  }

  return false;
}

const TECH_ALBUM_TOKENS =
  /\b(?:24\s*bit|16\s*bit|32\s*bit|web|flac|mp3|wav|aac|alac|ape|ogg|v0|v2|times|preluxe(?:\s+edition)?|deluxe(?:\s+edition)?|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|remaster(?:ed)?(?:\s+edition)?|standard(?:\s+edition)?|special(?:\s+edition)?|edition)\b/gi;

function looksLikeArtistMoniker(word: string): boolean {
  const w = word.trim();
  if (!w || w.length < 2 || w.length > 24) return false;
  if (WEAK_ARTIST_WORD.test(w)) return false;
  return /^[A-Z0-9]{2,}$/.test(w);
}

/** Album tail after a bad artist split — e.g. "& the Big Steppers" from "Mr. Morale & …". */
function albumPartLooksLikeTitleContinuation(album: string): boolean {
  const t = album.trim();
  if (!t) return true;
  if (/^[&+/([{–—-]/.test(t)) return true;
  if (/^(?:of|the|a|an|in|on|at|to|for)\b/i.test(t)) return true;
  return /^(?:&|and|feat\.?|ft\.?|featuring|with)\b/i.test(t);
}

/** Try "Artist Album…" when there is no "Artist - Album" dash separator. */
function tryExtractLeadingArtist(base: string): { artist?: string; album: string } {
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length < 2) return { album: base };

  const titleStubContext = { title: base, albumName: base };

  if (looksLikeArtistMoniker(words[0])) {
    const artist = words[0];
    const album = words.slice(1).join(' ').trim();
    if (
      album &&
      isUsableArtistName(artist) &&
      !isTitleFragmentArtistName(artist, titleStubContext) &&
      !albumPartLooksLikeTitleContinuation(album)
    ) {
      return { artist, album };
    }
  }

  for (let n = 2; n >= 1; n--) {
    if (words.length <= n) continue;
    const candidate = words.slice(0, n).join(' ');
    const album = words.slice(n).join(' ').trim();
    if (!album || !isUsableArtistName(candidate)) continue;
    if (isTitleFragmentArtistName(candidate, { ...titleStubContext, artist: candidate })) continue;
    if (albumPartLooksLikeTitleContinuation(album)) continue;
    if (WEAK_ARTIST_WORD.test(words[0])) continue;
    if (n === 1 && looksLikeArtistMoniker(words[0])) return { artist: candidate, album };
    if (n === 2 && words.slice(0, n).every((p) => /^[A-Z]/.test(p))) {
      return { artist: candidate, album };
    }
  }

  return { album: base };
}

/** Bare release years and numeric-only strings must never display as artist names. */
const BARE_YEAR_ARTIST_RE = /^(?:19|20)\d{2}$/;

/** Short all-caps monikers that are real performers (not scene leak watermarks). */
const TRUSTED_CAPS_MONIKER =
  /^(?:ABBA|ACDC|DMX|EMINEM|ESDEEKID|KORN|NAS|NWA|RZA|GZA|ODB|U2|XZIBIT)$/i;

/** Known scene leak / reupload watermarks — always rejected (case-insensitive). */
const KNOWN_LEAK_WATERMARKS = new Set([
  'canse',
  'burn my shadow',
  'burnmyshadow',
]);

/**
 * Scene leak / reupload watermarks (CANSE, BURN MY SHADOW, etc.) — never real album artists.
 * Official albums must be identified via iTunes/MusicBrainz title search instead.
 */
export function isLeakWatermarkArtistName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;

  const normalized = n.toLowerCase().replace(/\s+/g, ' ');
  if (KNOWN_LEAK_WATERMARKS.has(normalized)) return true;
  if (KNOWN_LEAK_WATERMARKS.has(normalized.replace(/\s/g, ''))) return true;

  const words = n.split(/\s+/).filter(Boolean);
  if (
    words.length >= 2 &&
    n === n.toUpperCase() &&
    words.every((w) => /^[A-Z0-9][A-Z0-9.'-]*$/i.test(w))
  ) {
    return true;
  }

  // Scene leak monikers like CANSE — short ALL-CAPS tokens only (not stylized names like ESDEEKID).
  if (
    words.length === 1 &&
    n === n.toUpperCase() &&
    /^[A-Z]{4,5}$/.test(n) &&
    !TRUSTED_CAPS_MONIKER.test(n)
  ) {
    return true;
  }

  return false;
}

/** True when any comma-separated credit segment is a scene leak watermark. */
export function artistLineContainsLeakWatermark(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return trimmed
    .split(/\s*,\s*/)
    .some((segment) => isLeakWatermarkArtistName(segment.trim()));
}

/** Remove leak-watermark segments from a comma-separated performer line. */
export function stripLeakWatermarkFromArtistLine(name: string): string {
  return name
    .split(/\s*,\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !isLeakWatermarkArtistName(segment))
    .join(', ');
}

export function isUsableArtistName(name?: string): boolean {
  const n = (name ?? '').trim();
  if (!n || PLACEHOLDER_ARTIST.test(n)) return false;
  if (isBadMediaStoreArtist(n)) return false;
  if (isTitleFragmentArtistName(n)) return false;
  if (WEAK_ARTIST_WORD.test(n)) return false;
  if (isLikelyUploaderHandleArtist(n)) return false;
  if (isArtistTitleMashupName(n)) return false;
  if (BARE_YEAR_ARTIST_RE.test(n)) return false;
  if (/^\d+$/.test(n)) return false;
  if (isLeakWatermarkArtistName(n)) return false;
  const primarySegment = n.split(/\s*,\s*/)[0]?.trim() ?? n;
  if (primarySegment && isLeakWatermarkArtistName(primarySegment)) return false;
  return n.length > 2;
}

/** Resolve artist/album for external lyrics lookup (skips "Local Upload" placeholders). */
export function resolveLyricsSearchArtist(
  title: string,
  artist: string,
  album: string,
  locker: LockerEntry | null,
): { artist: string; title: string; album: string } {
  let searchTitle = title.trim();
  let searchArtist = artist.trim();
  let searchAlbum = album.trim();

  if (locker) {
    if (locker.albumName?.trim()) searchAlbum = locker.albumName.trim();
    const resolved = resolveAlbumSearchArtist(
      locker.albumName ?? searchAlbum,
      locker.artist ?? searchArtist,
      [locker],
    );
    if (isUsableArtistName(resolved)) searchArtist = resolved;
    else if (isUsableArtistName(locker.albumArtist)) searchArtist = locker.albumArtist!.trim();
  } else if (!isUsableArtistName(searchArtist)) {
    const inferred = inferArtistFromAlbumFolder(searchAlbum, searchArtist);
    if (isUsableArtistName(inferred)) searchArtist = inferred;
    else searchArtist = '';
  }

  return { artist: searchArtist, title: searchTitle, album: searchAlbum };
}

/** Normalize album/artist strings for stable locker grouping keys. */
export function normalizeLockerKeyPart(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Collapse collab billing variants for locker album keys
 * (e.g. Future & Metro Boomin vs Future, Metro Boomin vs Metro Boomin, Future).
 */
export function normalizeLockerAlbumArtistKey(name: string): string {
  const expanded = name
    .trim()
    .replace(/\s*&\s*/gi, ' and ')
    .replace(/,/g, ' and ');
  const parts = normalizeLockerKeyPart(expanded)
    .split(/\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
  return parts.join(' and ');
}

/** Split locker billing into individual credited artists (preserves order). */
export function parseLockerArtistBilling(billing: string): string[] {
  const trimmed = billing.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/\s*,\s*|\s*&\s*|\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of parts) {
    const key = normalizeLockerAlbumArtistKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** True when a billed artist name matches an artist-hub filter (primary or guest). */
export function lockerArtistNameMatchesFilter(
  candidateName: string,
  filter: string,
): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const c = candidateName.trim().toLowerCase();
  if (!c) return false;
  const filterKey = normalizeLockerAlbumArtistKey(filter);
  const candidateKey = normalizeLockerAlbumArtistKey(candidateName);
  if (c === q || candidateKey === filterKey) return true;
  const primary = albumPrimaryArtist(candidateName).toLowerCase();
  if (primary === q) return true;
  if (c.startsWith(`${q},`) || q.startsWith(`${primary},`) || c.includes(q)) return true;
  const filterParts = filterKey.split(/\s+and\s+/).filter(Boolean);
  const candidateParts = candidateKey.split(/\s+and\s+/).filter(Boolean);
  return filterParts.every((part) =>
    candidateParts.some((cp) => cp === part || cp.startsWith(`${part} `)),
  );
}

/** True when a locker track belongs to an artist filter (tags, billing, or title feat.). */
export function lockerEntryMatchesArtistFilter(
  entry: Pick<
    LockerEntry,
    'title' | 'artist' | 'albumArtist' | 'trackPerformers' | 'trackSoloists'
  >,
  filter: string,
): boolean {
  const billings = [
    entry.albumArtist,
    entry.artist,
    entry.trackPerformers,
    entry.trackSoloists,
    albumPrimaryArtist(entry.albumArtist ?? ''),
    albumPrimaryArtist(entry.artist ?? ''),
  ].filter(Boolean) as string[];

  for (const billing of billings) {
    for (const name of parseLockerArtistBilling(billing)) {
      if (lockerArtistNameMatchesFilter(name, filter)) return true;
    }
  }

  const feat = featuredArtistsFromTrackTitle(entry.title ?? '');
  if (feat) {
    for (const name of parseLockerArtistBilling(feat)) {
      if (lockerArtistNameMatchesFilter(name, filter)) return true;
    }
  }

  return false;
}

/** True when an album collection's primary billing matches the artist filter. */
export function lockerCollectionPrimaryArtistMatches(
  collectionArtist: string,
  filter: string,
): boolean {
  return (
    lockerArtistNameMatchesFilter(collectionArtist, filter) ||
    lockerArtistNameMatchesFilter(albumPrimaryArtist(collectionArtist), filter)
  );
}

/** All billed artists on a locker album — header, per-track billing, and title feat. credits. */
export function collectLockerAlbumArtistCredits(
  primaryArtist: string,
  tracks: Pick<LockerEntry, 'title' | 'artist' | 'trackPerformers' | 'trackSoloists' | 'albumArtist'>[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushBilling = (billing: string) => {
    for (const name of parseLockerArtistBilling(billing)) {
      const key = normalizeLockerAlbumArtistKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  };
  pushBilling(primaryArtist);
  for (const track of tracks) {
    pushBilling(resolveLockerTrackArtistLine(track, primaryArtist));
    if (track.trackPerformers) pushBilling(track.trackPerformers);
    if (track.trackSoloists) pushBilling(track.trackSoloists);
    const feat = featuredArtistsFromTrackTitle(track.title);
    if (feat) pushBilling(feat);
  }
  return out;
}

/** Featured / guest artists on a locker album (excludes primary album billing). */
export function collectLockerGuestArtists(
  primaryArtist: string,
  tracks: Pick<LockerEntry, 'title' | 'artist' | 'trackPerformers' | 'trackSoloists' | 'albumArtist'>[],
): string[] {
  const primaryKeys = new Set(
    parseLockerArtistBilling(primaryArtist).map((n) => normalizeLockerAlbumArtistKey(n)),
  );
  return collectLockerAlbumArtistCredits(primaryArtist, tracks).filter(
    (name) => !primaryKeys.has(normalizeLockerAlbumArtistKey(name)),
  );
}

/** Tidal-style album header — "Artist feat. Guest1, Guest2". */
export function formatLockerAlbumFeaturingLine(
  primaryArtist: string,
  guestArtists: string[],
): string {
  const primary = primaryArtist.trim();
  if (!primary || guestArtists.length === 0) return primary;
  const guests = guestArtists.slice(0, 3).join(', ');
  const overflow = guestArtists.length > 3 ? ` and ${guestArtists.length - 3} more` : '';
  return `${primary} feat. ${guests}${overflow}`;
}

/** Primary artist before &/feat/featuring/with — avoids per-track featured splits. */
export function primaryLockerArtist(artistName: string): string {
  const segment =
    artistName.split(/\s*(?:&|feat\.?|ft\.?|featuring|with)\s*/i)[0] ?? artistName;
  return segment.trim();
}

/** Album-level artist — first billed name before comma (e.g. "Metro Boomin, Travis Scott"). */
export function albumPrimaryArtist(artistName: string): string {
  const trimmed = artistName.trim();
  if (!trimmed) return trimmed;
  const first = trimmed.split(',')[0]?.trim() ?? trimmed;
  return primaryLockerArtist(first);
}

/** Majority primary track artist — ignores bad ID3 TPE2 (album artist) tags. */
export function lockerTrackArtistConsensus(
  tracks: (Pick<LockerEntry, 'artist'> & StubArtistContext)[],
): string | null {
  if (tracks.length === 0) return null;

  const counts = new Map<string, { name: string; count: number }>();
  for (const track of tracks) {
    const primary = primaryLockerArtist((track.artist ?? '').trim());
    if (!isUsableArtistName(primary)) continue;
    if (isMislabeledPlaylistStubArtist(primary, track)) continue;
    const key = normalizeLockerKeyPart(primary);
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { name: primary, count: 1 });
  }

  if (counts.size === 0) return null;

  let best: { name: string; count: number } | null = null;
  for (const row of counts.values()) {
    if (!best || row.count > best.count) best = row;
  }
  if (!best) return null;

  const threshold = Math.max(2, Math.ceil(tracks.length * 0.5));
  return best.count >= threshold ? best.name : null;
}

function albumArtistConflictsWithConsensus(
  albumArtist: string | undefined,
  consensus: string | null,
): boolean {
  if (!consensus || !albumArtist?.trim()) return false;
  const aa = albumArtist.trim();
  if (!isUsableArtistName(aa)) return false;
  return normalizeLockerKeyPart(aa) !== normalizeLockerKeyPart(consensus);
}

/** True when stored TPE2 album artist disagrees with track-level artist consensus. */
export function lockerAlbumArtistNeedsIdentification(
  tracks: Pick<LockerEntry, 'albumArtist' | 'artist'>[],
): boolean {
  if (tracks.length === 0) return false;
  if (tracks.some((t) => t.albumArtist?.trim() && !isUsableArtistName(t.albumArtist))) {
    return true;
  }
  const consensus = lockerTrackArtistConsensus(tracks);
  if (!consensus) {
    const albumName = (tracks[0] as { albumName?: string }).albumName?.trim();
    const onlyLeakTags = tracks.every((t) => {
      const aa = t.albumArtist?.trim();
      const primary = primaryLockerArtist((t.artist ?? '').trim());
      return (!aa || !isUsableArtistName(aa)) && (!primary || !isUsableArtistName(primary));
    });
    return Boolean(albumName && onlyLeakTags);
  }
  return tracks.some((t) => albumArtistConflictsWithConsensus(t.albumArtist, consensus));
}

/** Canonical album artist for locker grouping and display. */
export function lockerAlbumGroupArtist(
  entry: Pick<LockerEntry, 'albumArtist' | 'artist'> & StubArtistContext,
  tracks?: (Pick<LockerEntry, 'albumArtist' | 'artist'> & StubArtistContext)[],
): string {
  const sample = tracks && tracks.length > 0 ? tracks[0]! : entry;

  if (tracks && tracks.length > 0) {
    const fromAlbumConsensus = lockerAlbumArtistConsensus(tracks);
    if (
      isUsableArtistName(fromAlbumConsensus) &&
      fromAlbumConsensus !== 'Local Upload' &&
      !isMislabeledPlaylistStubArtist(fromAlbumConsensus, sample)
    ) {
      return fromAlbumConsensus;
    }
  }

  const fromAlbum = entry.albumArtist?.trim();
  const fromTrack = primaryLockerArtist((entry.artist ?? '').trim());

  if (
    fromAlbum &&
    isUsableArtistName(fromAlbum) &&
    !isMislabeledPlaylistStubArtist(fromAlbum, sample)
  ) {
    return albumPrimaryArtist(fromAlbum);
  }
  const trackConsensus =
    tracks && tracks.length > 0 ? lockerTrackArtistConsensus(tracks) : null;
  if (trackConsensus && !isMislabeledPlaylistStubArtist(trackConsensus, sample)) {
    return trackConsensus;
  }
  if (isUsableArtistName(fromTrack) && !isMislabeledPlaylistStubArtist(fromTrack, sample)) {
    return fromTrack;
  }
  return 'Local Upload';
}

/** Majority album artist for a release — ignores per-track featured artist tag noise. */
export function lockerAlbumArtistConsensus(
  tracks: (Pick<LockerEntry, 'albumArtist' | 'artist'> & StubArtistContext)[],
): string {
  if (tracks.length === 0) return 'Local Upload';
  const counts = new Map<string, { name: string; count: number }>();
  for (const track of tracks) {
    const fromAlbum = track.albumArtist?.trim();
    const candidate =
      fromAlbum && isUsableArtistName(fromAlbum) && !isMislabeledPlaylistStubArtist(fromAlbum, track)
        ? albumPrimaryArtist(fromAlbum)
        : albumPrimaryArtist(primaryLockerArtist(track.artist ?? ''));
    if (!isUsableArtistName(candidate)) continue;
    if (isMislabeledPlaylistStubArtist(candidate, track)) continue;
    const key = normalizeLockerKeyPart(candidate);
    const row = counts.get(key);
    if (row) row.count += 1;
    else counts.set(key, { name: candidate, count: 1 });
  }
  let best: { name: string; count: number } | null = null;
  for (const row of counts.values()) {
    if (!best || row.count > best.count) best = row;
  }
  return best?.name ?? lockerAlbumGroupArtist(tracks[0]!);
}

/** Best album-artist line for UI — prefers full collab billing from TPE2 tags. */
export function lockerAlbumDisplayArtist(
  entry: Pick<LockerEntry, 'albumArtist' | 'artist'>,
  tracks?: Pick<LockerEntry, 'albumArtist' | 'artist'>[],
): string {
  const pool = tracks && tracks.length > 0 ? tracks : [entry];
  const rawCounts = new Map<string, number>();
  for (const track of pool) {
    const raw = track.albumArtist?.trim();
    if (!raw || !isUsableArtistName(raw) || /^local upload$/i.test(raw)) continue;
    rawCounts.set(raw, (rawCounts.get(raw) ?? 0) + 1);
  }
  if (rawCounts.size > 0) {
    let best = '';
    let bestCount = -1;
    for (const [raw, count] of rawCounts) {
      const prefersCollab =
        /[&/,]/.test(raw) && (!best || !/[&/,]/.test(best));
      if (
        count > bestCount ||
        (count === bestCount && (raw.length > best.length || prefersCollab))
      ) {
        best = raw;
        bestCount = count;
      }
    }
    if (best) return best;
  }
  return lockerAlbumGroupArtist(entry, pool);
}

/** Stable album group key: normalized title + collab-aware album artist. */
export function lockerAlbumGroupKey(
  entry: Pick<LockerEntry, 'albumName' | 'albumArtist' | 'artist'>,
): string | null {
  const name = entry.albumName?.trim();
  if (!name) return null;
  const artist = normalizeLockerAlbumArtistKey(lockerAlbumGroupArtist(entry));
  return `${normalizeLockerKeyPart(name)}::${artist}`;
}

/** Sync album-group cover for one locker row — shared by vault cache, envelopes, and player UI. */
export function resolveLockerEntryGroupArt(
  entry: Pick<LockerEntry, 'albumName' | 'albumArtist' | 'artist' | 'albumArt' | 'id'>,
  pool?: ReadonlyArray<LockerEntry> | null,
): string | undefined {
  const snap = pool ?? getLockerEntriesSnapshot();
  if (!snap?.length) return sanitizeCoverArtUrl(entry.albumArt);
  const albumKey = lockerAlbumGroupKey(entry);
  const siblings = albumKey
    ? snap.filter((row) => lockerAlbumGroupKey(row) === albumKey)
    : [entry as LockerEntry];
  return resolveLockerTrackThumbArt(entry, albumKey, siblings, undefined, undefined);
}

/**
 * In-memory heal: every track inherits album-group art when any sibling (or session cache) has cover.
 * Safe to call on every vault cache refresh — never deletes rows or blobs.
 */
export function inheritLockerAlbumArt(entries: LockerEntry[]): LockerEntry[] {
  if (entries.length === 0) return entries;

  const groupArtByKey = new Map<string, string>();
  for (const entry of entries) {
    const key = lockerAlbumGroupKey(entry);
    if (!key || groupArtByKey.has(key)) continue;
    const siblings = entries.filter((row) => lockerAlbumGroupKey(row) === key);
    const art = pickLockerAlbumCover(siblings);
    if (art) {
      groupArtByKey.set(key, art);
      rememberKnownGoodAlbumArt(key, art);
    }
  }

  return entries.map((entry) => {
    const resolved = resolveLockerEntryGroupArt(entry, entries);
    if (!resolved) return entry;
    const current = sanitizeCoverArtUrl(entry.albumArt);
    if (!current) return { ...entry, albumArt: resolved };
    if (current === resolved) return entry;
    if (isPersistentAlbumArt(resolved) && !isPersistentAlbumArt(current)) {
      return { ...entry, albumArt: resolved };
    }
    return entry;
  });
}

/**
 * Persist durable sibling album art onto rows that lack cover metadata in IndexedDB.
 * Heals hollow/re-downloaded tracks after blob wipes without touching audio blobs.
 */
export async function healInheritedAlbumArtToStorage(): Promise<number> {
  const rows = await readAllLockerRows();
  const { entries } = await readLockerEntriesFromDb();
  const inherited = inheritLockerAlbumArt(entries);
  let healed = 0;

  for (let i = 0; i < entries.length; i++) {
    const before = entries[i]!;
    const after = inherited[i]!;
    const newArt = after.albumArt?.trim();
    if (!newArt || newArt === before.albumArt) continue;
    if (!isPersistentAlbumArt(newArt)) continue;
    const row = rows.find((r) => r.id === before.id);
    if (row && rowHasPersistedCover(row)) continue;
    await updateLockerEntryMetadata(
      before.id,
      { albumArt: newArt },
      { skipCacheRefresh: true },
    );
    healed += 1;
  }

  if (healed > 0) await refreshLockerCache();
  return healed;
}
export function parseAlbumFolderName(folderName: string): {
  artist?: string;
  album: string;
  year?: string;
} {
  const original = (folderName ?? '').trim();
  if (!original) return { album: '' };

  let year: string | undefined;
  let base = original
    .replace(/[[({][^\])}]*[\])}]/g, (match) => {
      const inner = match.slice(1, -1).trim();
      if (/^(?:19|20)\d{2}$/.test(inner)) {
        year = inner;
        return ' ';
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (!year) {
    const tok = base.match(/\b((?:19|20)\d{2})\b/);
    if (tok) year = tok[1];
  }

  base = base
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(TECH_ALBUM_TOKENS, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const dashParts = base
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (dashParts.length >= 2) {
    const artist = dashParts[0];
    const album = dashParts.slice(1).join(' - ').trim();
    if (BARE_YEAR_ARTIST_RE.test(artist)) {
      return { album: base || original, year: year ?? artist };
    }
    if (isUsableArtistName(artist)) {
      return { artist, album: album || original, year };
    }
    return { album: base || original, year };
  }

  const leading = tryExtractLeadingArtist(base);
  if (leading.artist) {
    return { artist: leading.artist, album: leading.album || original, year };
  }

  return { album: base || original, year };
}

export function inferArtistFromAlbumFolder(albumName: string, artist: string): string {
  const a = (artist ?? '').trim();
  if (isUsableArtistName(a)) return a;
  const parsed = parseAlbumFolderName(albumName);
  if (parsed.artist && isUsableArtistName(parsed.artist)) return parsed.artist;
  return 'Local Upload';
}

/** Best artist hint for online cover lookup (album artist → track artist → folder guess). */
export function resolveAlbumSearchArtist(
  albumName: string,
  groupArtist: string,
  tracks: Pick<LockerEntry, 'albumArtist' | 'artist' | 'performers'>[],
): string {
  const fromAlbumArtist = tracks
    .map((t) => t.albumArtist?.trim())
    .find((a) => isUsableArtistName(a));
  if (fromAlbumArtist) {
    return fromAlbumArtist;
  }

  const consensus = lockerTrackArtistConsensus(tracks);

  const fromTrackArtist = tracks
    .map((t) => t.artist?.trim())
    .find((a) => isUsableArtistName(a));
  if (fromTrackArtist) return fromTrackArtist;

  const fromPerformers = tracks
    .map((t) => t.performers?.split(',')[0]?.trim())
    .find((a) => isUsableArtistName(a));
  if (fromPerformers) return fromPerformers;

  const fromFolder = parseAlbumFolderName(albumName).artist;
  if (isUsableArtistName(fromFolder)) return fromFolder!;

  const inferred = inferArtistFromAlbumFolder(albumName, groupArtist);
  return isUsableArtistName(inferred) ? inferred : '';
}

/** Banner-safe artist — never returns placeholder labels like "Local Upload". */
export function resolveAlbumBannerArtist(
  albumName: string,
  groupArtist: string,
  tracks: Pick<LockerEntry, 'albumArtist' | 'artist' | 'performers'>[],
  identifiedArtist?: string,
): string {
  const identified = identifiedArtist?.trim();
  if (identified && isUsableArtistName(identified)) return identified;
  const artist = resolveAlbumSearchArtist(albumName, groupArtist, tracks);
  return isUsableArtistName(artist) ? artist : '';
}

function isSparsePrimaryTrackBilling(billing: string, primaryArtist: string): boolean {
  const parts = parseLockerArtistBilling(billing);
  if (parts.length !== 1) return false;
  return (
    normalizeLockerAlbumArtistKey(parts[0]!) === normalizeLockerAlbumArtistKey(primaryArtist)
  );
}

function resolveSparseLockerTrackArtistLine(
  track: Pick<LockerEntry, 'title' | 'albumName'>,
  primaryArtist: string,
): string | null {
  const bundled = lookupBundledTrackArtistLine(
    track.albumName,
    primaryArtist,
    track.title,
  );
  if (bundled) return bundled;
  const feat = featuredArtistsFromTrackTitle(track.title);
  if (feat) return `${primaryArtist}, ${feat}`;
  return null;
}

/** Per-track artist line for locker UI — catalog credits, usable tags, or feat. from title. */
export function resolveLockerTrackArtistLine(
  track: Pick<LockerEntry, 'title' | 'artist' | 'trackPerformers' | 'albumArtist' | 'albumName'>,
  albumArtist?: string,
  albumName?: string,
): string {
  const cleanedPerformers = stripLeakWatermarkFromArtistLine(track.trackPerformers?.trim() ?? '');
  if (cleanedPerformers && !artistLineContainsLeakWatermark(track.trackPerformers ?? '')) {
    return cleanedPerformers;
  }

  const rawArtist = track.artist?.trim() ?? '';
  const hadLeak = artistLineContainsLeakWatermark(rawArtist);
  const cleanedArtist = stripLeakWatermarkFromArtistLine(rawArtist);
  const album = (albumArtist ?? track.albumArtist)?.trim();
  const cleanBanner = album && isUsableArtistName(album) ? album : '';
  const albumTitle = (albumName ?? track.albumName)?.trim();

  if (cleanedArtist && isUsableArtistName(cleanedArtist) && !hadLeak) {
    if (cleanBanner && isSparsePrimaryTrackBilling(cleanedArtist, cleanBanner)) {
      const sparse = resolveSparseLockerTrackArtistLine(
        { title: track.title, albumName: albumTitle },
        cleanBanner,
      );
      if (sparse) return sparse;
    }
    return cleanedArtist;
  }

  if (cleanBanner) {
    if (cleanedArtist && hadLeak) {
      return `${cleanBanner}, ${cleanedArtist}`;
    }
    const sparse = resolveSparseLockerTrackArtistLine(
      { title: track.title, albumName: albumTitle },
      cleanBanner,
    );
    if (sparse) return sparse;
    return cleanBanner;
  }

  if (cleanedArtist && isUsableArtistName(cleanedArtist)) return cleanedArtist;

  return featuredArtistsFromTrackTitle(track.title) ?? '';
}

function probeViaAudioElement(source: Blob | string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const revoke = typeof source !== 'string';
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const done = (seconds: number) => {
      if (revoke) URL.revokeObjectURL(url);
      audio.src = '';
      audio.remove();
      resolve(seconds);
    };
    audio.addEventListener(
      'loadedmetadata',
      () => {
        const raw = audio.duration;
        done(Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0);
      },
      { once: true },
    );
    audio.addEventListener('error', () => done(0), { once: true });
    audio.src = url;
  });
}

async function probeViaDecode(blob: Blob): Promise<number> {
  // Full decodeAudioData buffers the entire PCM in memory. On Android WebView this OOM-crashes
  // the app during downloads (several tracks decoding at once), so cap hard there.
  const maxBytes = isAndroid() ? 12 * 1024 * 1024 : 120 * 1024 * 1024;
  if (blob.size <= 0 || blob.size > maxBytes) return 0;
  try {
    const ctx = new AudioContext();
    const buffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    await ctx.close();
    return decoded.duration > 0 ? Math.round(decoded.duration) : 0;
  } catch {
    return 0;
  }
}

async function sourceToBlob(source: Blob | string): Promise<Blob | null> {
  if (typeof source !== 'string') return source;
  try {
    const res = await fetch(source);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Read length from uploaded audio (FLAC/MP3/etc.) in the browser. */
export async function probeAudioDuration(
  source: Blob | string,
  opts?: { allowDecode?: boolean },
): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const viaTag = await probeViaAudioElement(source);
  if (viaTag > 0) return viaTag;
  // Heavy decode fallback is opt-out for background downloads (OOM risk).
  if (opts?.allowDecode === false) return 0;
  const blob = await sourceToBlob(source);
  if (blob) return probeViaDecode(blob);
  return 0;
}

/** Best-effort unsynchronised lyrics from a locker audio blob (ID3 USLT). */
export async function readEmbeddedLyricsFromLocker(sourceId: string): Promise<string | null> {
  const blob = await readEntryAudioBlob(sourceId);
  if (!blob) return null;
  try {
    const head = blob.slice(0, Math.min(blob.size, 512 * 1024));
    const tags = parseId3v2Tags(await head.arrayBuffer());
    const lyrics = tags.lyrics?.trim();
    return lyrics || null;
  } catch {
    return null;
  }
}

export async function getLockerAudioBlob(id: string): Promise<Blob | null> {
  const raw = await readEntryAudioBlob(id);
  return coerceReadableAudioBlob(raw, id);
}

async function readLockerRowById(id: string): Promise<Record<string, unknown> | undefined> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Re-register locker audio for playback — IndexedDB blob, native content cache, or
 * on-disk nativeSourcePath (yt-dlp temp file) after app restart or cache eviction.
 */
async function readLockerAudioBlobWithRetry(id: string, attempts = 5): Promise<Blob | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const blob = await getLockerAudioBlob(id);
    if (blob && blob.size > 0) return blob;
    if (attempt < attempts - 1) {
      const { yieldToMain } = await import('./yieldToMain');
      await yieldToMain();
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  return null;
}

export async function healLockerEntryNativePlayback(entryId: string): Promise<string | null> {
  const id = entryId.trim().replace(/^local-/, '');
  if (!id) return null;

  if (isAndroid()) {
    const { registerLockerBlobFromBlob, registerLockerBlobFromFileUri, probeNativeLockerContentUri } =
      await import('./nativeExoLockerBridge');
    const cached = await probeNativeLockerContentUri(id);
    if (cached) return cached;

    const blob = await readLockerAudioBlobWithRetry(id);
    if (blob && blob.size > 0) {
      const uri = await registerLockerBlobFromBlob(id, blob, blob.type || undefined);
      if (uri) return uri;
    }

    const row = await readLockerRowById(id);
    const sourcePath =
      typeof row?.nativeSourcePath === 'string' ? row.nativeSourcePath.trim() : '';
    // Never import from our own content:// cache URI — it is a pointer, not a source file.
    // ytdlp-locker temps may live under files/ (durable) or legacy cache/; still importable.
    if (
      sourcePath &&
      (isStableNativeAudioPath(sourcePath) || /\/ytdlp-locker\//i.test(sourcePath))
    ) {
      const imported = await registerLockerBlobFromFileUri(id, sourcePath);
      if (imported?.contentUri) return imported.contentUri;
    }
    return null;
  }

  const blob = await getLockerAudioBlob(id);
  if (!blob || blob.size <= 0) return null;
  return refreshLockerEntryPlayUrl(id);
}

/** Resolve cover art for a locker row — persistent URL or fresh blob URL from IDB. */
export async function resolveLockerArtworkUrl(entryId: string): Promise<string | undefined> {
  const id = entryId.trim().replace(/^local-/, '');
  if (!id) return undefined;
  const entry = (await getLockerEntries()).find((e) => e.id === id);
  if (entry?.albumArt && isPersistentAlbumArt(entry.albumArt)) {
    return entry.albumArt.trim();
  }
  const currentArt = entry?.albumArt?.trim();
  if (currentArt?.startsWith('blob:') && (await blobObjectUrlIsLive(currentArt))) {
    return currentArt;
  }
  const blob = await getLockerArtBlob(id);
  if (blob && blob.size > 0) {
    return URL.createObjectURL(blob);
  }
  const art = entry?.albumArt?.trim();
  if (art && !art.startsWith('blob:')) return art;

  const snap = lockerCache ?? (await getLockerEntries());
  if (entry && snap.length > 0) {
    const albumKey = lockerAlbumGroupKey(entry);
    const siblings = albumKey
      ? snap.filter((row) => lockerAlbumGroupKey(row) === albumKey)
      : [entry];
    const groupArt = resolveLockerTrackThumbArt(
      entry,
      albumKey,
      siblings.length > 0 ? siblings : [entry],
      undefined,
      undefined,
    );
    if (groupArt) return groupArt;
  }
  return undefined;
}

async function coerceReadableAudioBlob(blob: Blob | null, id: string): Promise<Blob | null> {
  if (!blob) return null;
  if (blob.size > 0) return blob;
  try {
    const ab = await blob.arrayBuffer();
    if (ab.byteLength > 0) {
      return new Blob([ab], { type: blob.type || sniffAudioMime(ab) || 'audio/mpeg' });
    }
  } catch {
    /* try FileReader */
  }
  try {
    const viaReader = await new Promise<Blob | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => {
        const result = fr.result;
        if (result instanceof ArrayBuffer && result.byteLength > 0) {
          resolve(
            new Blob([result], { type: blob.type || sniffAudioMime(result) || 'audio/mpeg' }),
          );
        } else {
          resolve(null);
        }
      };
      fr.onerror = () => resolve(null);
      fr.readAsArrayBuffer(blob);
    });
    if (viaReader && viaReader.size > 0) return viaReader;
  } catch (err) {
    console.warn('[locker] FileReader audio coerce failed', id, err);
  }
  return null;
}

async function readEntryAudioBlob(id: string): Promise<Blob | null> {
  const db = await initDB();
  const fromBlobStore = await new Promise<Blob | null>((resolve, reject) => {
    if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
      resolve(null);
      return;
    }
    const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
    const req = tx.objectStore(BLOB_STORE_NAME).get(id);
    req.onsuccess = () => {
      const row = req.result as TrackBlobRow | undefined;
      if (!row) {
        resolve(null);
        return;
      }
      const blob = storedAudioToBlob(row.audioBlob);
      if (!blob && row.audioBlob != null && import.meta.env.DEV) {
        console.warn('[locker] unreadable audioBlob type', id, typeof row.audioBlob);
      }
      resolve(blob);
    };
    req.onerror = () => reject(req.error);
  });
  if (fromBlobStore) return fromBlobStore;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const row = req.result as { audioBlob?: Blob } | undefined;
      resolve(storedAudioToBlob(row?.audioBlob) ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function readEntryArtBlob(id: string): Promise<Blob | null> {
  const db = await initDB();
  const fromBlobStore = await new Promise<Blob | null>((resolve, reject) => {
    if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
      resolve(null);
      return;
    }
    const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
    const req = tx.objectStore(BLOB_STORE_NAME).get(id);
    req.onsuccess = () => {
      const row = req.result as TrackBlobRow | undefined;
      resolve(storedArtToBlob(row?.albumArtBlob));
    };
    req.onerror = () => reject(req.error);
  });
  if (fromBlobStore) return fromBlobStore;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const row = req.result as { albumArtBlob?: unknown } | undefined;
      resolve(storedArtToBlob(row?.albumArtBlob));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLockerArtBlob(entryId: string): Promise<Blob | null> {
  return readEntryArtBlob(entryId);
}

/** Drop persisted cover bytes from the blob store (keeps audio blob when present). */
async function clearEntryArtBlob(id: string): Promise<void> {
  const db = await initDB();
  if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const blobStore = tx.objectStore(BLOB_STORE_NAME);
    const trackStore = tx.objectStore(STORE_NAME);
    const blobReq = blobStore.get(id);
    blobReq.onsuccess = () => {
      const blobRow = blobReq.result as TrackBlobRow | undefined;
      if (!blobRow?.albumArtBlob) return;
      const audioBlob = storedAudioToBlob(blobRow.audioBlob) ?? undefined;
      if (audioBlob) {
        blobStore.put({ id, audioBlob } satisfies TrackBlobRow);
      } else {
        blobStore.delete(id);
      }
    };
    blobReq.onerror = () => reject(blobReq.error);
    const trackReq = trackStore.get(id);
    trackReq.onsuccess = () => {
      const row = trackReq.result as Record<string, unknown> | undefined;
      if (!row || !('albumArtBlob' in row)) return;
      delete row.albumArtBlob;
      trackStore.put(row);
    };
    trackReq.onerror = () => reject(trackReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Backfill missing track lengths for existing locker uploads. */
export async function repairLockerDurations(entries?: LockerEntry[]): Promise<void> {
  const list = entries ?? (await getLockerEntries());
  let changed = false;
  for (const entry of list) {
    if (entry.durationSeconds > 0) continue;
    let sec = await probeAudioDuration(entry.url);
    if (sec <= 0) {
      const blob = await readEntryAudioBlob(entry.id);
      if (blob) sec = await probeAudioDuration(blob);
    }
    if (sec <= 0) continue;
    await updateLockerEntryMetadata(
      entry.id,
      { durationSeconds: sec },
      { skipCacheRefresh: true },
    );
    changed = true;
  }
  if (changed) await refreshLockerCache();
}

/** Repair durations for one album (called when opening album detail). */
export async function repairAlbumGroupDurations(
  albumName: string,
  artist: string,
): Promise<void> {
  const list = await getLockerEntries();
  const tracks = tracksForAlbumGroup(list, albumName, artist);
  if (tracks.length === 0) return;
  await repairLockerDurations(tracks);
}

/** Prefer obvious cover art filenames over random images in upload folders. */
function pickAlbumCoverImage(files: File[]): File | undefined {
  const images = files.filter(isImageFile);
  if (images.length === 0) return undefined;
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (/^(folder|cover|album|front|artwork|thumb)/.test(n)) return 10;
    if (n.includes('cover') || n.includes('folder') || n.includes('front')) return 6;
    return 0;
  };
  return [...images].sort((a, b) => score(b.name) - score(a.name))[0];
}

function titleCaseWord(word: string): string {
  if (!word) return '';
  const lower = word.toLowerCase();
  if (lower === 'feat' || lower === 'ft') return 'feat.';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Strip leading track/disc numbers — idempotent at display time. */
export function normaliseTitle(raw: string): string {
  let title = (raw ?? '').trim();
  if (!title) return '';
  title = title.replace(/^(\d{1,3}[\s\-_.]+)+/i, '');
  title = title.replace(/^track\s*\d+[\s\-_.]+/i, '');
  title = title.replace(/^disc\s*\d+[\s\-_.]+/i, '');
  return title.trim();
}

export interface Id3Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: string;
  track?: string;
  disc?: string;
  genre?: string;
  /** ID3 TKEY / initial key for harmonic mixing. */
  initialKey?: string;
  /** Unsynchronised lyrics (USLT frame). */
  lyrics?: string;
  /** True only when IDB bytes or Android native cache exist — set at vault load. */
  offlineReady?: boolean;
}

function readSynchsafeInt(view: DataView, offset: number): number {
  return (
    (view.getUint8(offset) << 21) |
    (view.getUint8(offset + 1) << 14) |
    (view.getUint8(offset + 2) << 7) |
    view.getUint8(offset + 3)
  );
}

function decodeId3Bytes(encoding: number, bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  const slice = bytes.subarray(0, end);
  if (encoding === 1 || encoding === 2) {
    return new TextDecoder('utf-16').decode(slice).replace(/\0/g, '').trim();
  }
  if (encoding === 3) {
    return new TextDecoder('utf-8').decode(slice).trim();
  }
  return new TextDecoder('latin1').decode(slice).trim();
}

function decodeId3Text(data: Uint8Array): string {
  if (data.length === 0) return '';
  return decodeId3Bytes(data[0], data.subarray(1));
}

/** USLT: encoding + 3-byte language + null-terminated descriptor + lyrics text. */
function decodeId3Lyrics(data: Uint8Array): string {
  if (data.length < 5) return '';
  const encoding = data[0];
  let offset = 4;
  while (offset < data.length && data[offset] !== 0) offset++;
  if (offset < data.length) offset++;
  return decodeId3Bytes(encoding, data.subarray(offset));
}

/** Minimal ID3v2 tag reader for common text frames. */
export function parseId3v2Tags(buffer: ArrayBuffer): Id3Tags {
  if (buffer.byteLength < 10) return {};
  const view = new DataView(buffer);
  const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
  if (sig !== 'ID3') return {};
  const major = view.getUint8(3);
  const tagSize = major === 4 ? readSynchsafeInt(view, 6) : view.getUint32(6);
  let offset = 10;
  const end = Math.min(10 + tagSize, buffer.byteLength);
  const tags: Id3Tags = {};
  while (offset + 10 <= end) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = major === 4 ? readSynchsafeInt(view, offset + 4) : view.getUint32(offset + 4);
    offset += 10;
    if (frameSize <= 0 || offset + frameSize > end) break;
    const text = decodeId3Text(new Uint8Array(buffer, offset, frameSize));
    if (id === 'TIT2') tags.title = text;
    else if (id === 'TPE1') tags.artist = text;
    else if (id === 'TPE2') tags.albumArtist = text;
    else if (id === 'TALB') tags.album = text;
    else if (id === 'TDRC' || id === 'TYER') tags.year = text.slice(0, 4);
    else if (id === 'TRCK') tags.track = text;
    else if (id === 'TPOS') tags.disc = text;
    else if (id === 'TCON') tags.genre = text;
    else if (id === 'TKEY') tags.initialKey = text;
    else if (id === 'USLT' && !tags.lyrics) {
      const lyrics = decodeId3Lyrics(new Uint8Array(buffer, offset, frameSize));
      if (lyrics) tags.lyrics = lyrics;
    }
    offset += frameSize;
  }
  return tags;
}

async function readId3FromFile(file: File): Promise<Id3Tags> {
  try {
    const head = file.slice(0, Math.min(file.size, 256 * 1024));
    return parseId3v2Tags(await head.arrayBuffer());
  } catch {
    return {};
  }
}

function artistFromFilename(name: string): string | undefined {
  const base = name.replace(/\.[^/.]+$/, '');
  const dash = base.split(/\s+[-–—]\s+/);
  if (dash.length >= 2 && dash[0].trim()) return dash[0].trim();
  return undefined;
}

function resolveUploadArtist(
  file: File,
  id3: Id3Tags,
  folderArtist?: string,
  explicitArtist?: string,
): string {
  const fromExplicit = explicitArtist?.trim();
  if (fromExplicit && !PLACEHOLDER_ARTIST.test(fromExplicit)) return fromExplicit;
  const tpe1 = id3.artist?.trim();
  if (tpe1 && !PLACEHOLDER_ARTIST.test(tpe1)) return tpe1;
  const tpe2 = id3.albumArtist?.trim();
  if (tpe2 && isUsableArtistName(tpe2)) return tpe2;
  const fromFile = artistFromFilename(file.name);
  if (fromFile && !PLACEHOLDER_ARTIST.test(fromFile)) return fromFile;
  if (folderArtist?.trim()) {
    const parsed = parseAlbumFolderName(folderArtist);
    if (parsed.artist && isUsableArtistName(parsed.artist)) return parsed.artist;
  }
  return 'Local Upload';
}

/** Turn raw filenames into readable track titles (no underscores/dashes clutter). */
export function formatDisplayTrackTitle(filenameOrTitle: string): string {
  const raw = (filenameOrTitle ?? '').trim();
  if (!raw) return 'Untitled';
  let s = normaliseTitle(raw.replace(/\.[^/.]+$/, '').trim());
  s = s.replace(/_\(\s*feat\.?\s*/gi, ' (feat. ');
  s = s.replace(/_\(/g, ' (');
  s = s.replace(/_/g, ' ');
  s = s.replace(/-/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.includes('(feat') && !s.endsWith(')')) {
    s = `${s})`;
  }

  const featParen = s.match(/^(.*?)\s*\(\s*feat\.?\s*([^)]+)\s*\)\s*$/i);
  if (featParen) {
    const main = featParen[1]
      .split(' ')
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    const guests = featParen[2]
      .split(/\s+/)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return `${main} (feat. ${guests})`;
  }

  const featTrail = s.match(/^(.*?)\s+feat\.?\s+(.+)$/i);
  if (featTrail) {
    const main = featTrail[1]
      .split(' ')
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    const guests = featTrail[2]
      .split(/\s+/)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return `${main} (feat. ${guests})`;
  }

  return s
    .split(' ')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

export function parseTrackTitleFromFilename(filename: string): string {
  return formatDisplayTrackTitle(filename);
}

/** Cosmetic cleanup for locker album labels — never strips artist prefixes from stored titles. */
function stripAlbumFolderNoise(folderName: string): string {
  const original = (folderName ?? '').trim();
  if (!original) return '';

  let base = original
    .replace(/[[({][^\])}]*[\])}]/g, (match) => {
      const inner = match.slice(1, -1).trim();
      if (/^(?:19|20)\d{2}$/.test(inner)) return ' ';
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  base = base
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(TECH_ALBUM_TOKENS, ' ')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return base || original;
}

export function formatAlbumDisplayName(folderName: string): string {
  const album = stripAlbumFolderNoise(folderName);
  if (!album) return '';
  return album
    .split(' ')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

/** Year from folder name or track metadata — for album banner date row. */
export function resolveAlbumReleaseYear(
  folderName: string,
  tracks: Pick<LockerEntry, 'releaseYear'>[],
): string | undefined {
  const fromTrack = tracks.map((t) => t.releaseYear?.trim()).find(Boolean);
  if (fromTrack) return fromTrack;
  return parseAlbumFolderName(folderName).year;
}

/** Infer album folder name from a directory upload (webkitRelativePath). */
export function inferAlbumFromFiles(files: FileList | File[]): {
  albumName: string;
  fromFolder: boolean;
} {
  const list = [...files];
  if (list.length === 0) return { albumName: '', fromFolder: false };
  const rel = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel && rel.includes('/')) {
    const folder = rel.split('/')[0]?.trim();
    if (folder) return { albumName: folder, fromFolder: true };
  }
  return { albumName: '', fromFolder: false };
}

function rowToEntry(t: {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  durationSeconds?: number;
  audioBlob?: Blob;
  hasAudioBlob?: boolean;
  url?: string;
  albumName?: string;
  albumArt?: string;
  albumArtBlob?: Blob;
  releaseYear?: string;
  albumArtist?: string;
  composer?: string;
  trackNumber?: number;
  discNumber?: number;
  discCount?: string;
  performers?: string;
  producers?: string;
  engineers?: string;
  linerNotesUrl?: string;
  bookletUrl?: string;
  creditsJson?: string;
  trackPerformers?: string;
  trackProducers?: string;
  trackSoloists?: string;
  lyrics?: string;
  addedAt?: number;
  nativeAudioCached?: boolean;
  nativeSourcePath?: string;
}): LockerEntry | null {
  const hasBlob = Boolean(t.hasAudioBlob) || Boolean(t.audioBlob);
  const nativeCached = Boolean(t.nativeAudioCached);
  const url = t.url?.trim() || '';
  if (!url && !hasBlob && !nativeCached) return null;
  const albumArt = isPersistentAlbumArt(t.albumArt)
    ? t.albumArt!.trim()
    : resolveAlbumArtForRow({ albumArt: t.albumArt, albumArtBlob: t.albumArtBlob });
  return {
    id: t.id,
    title: formatDisplayTrackTitle(t.title ?? ''),
    artist: (t.artist ?? '').trim() || 'Local Upload',
    genre: t.genre ?? 'Local',
    durationSeconds: t.durationSeconds ?? 0,
    url,
    addedAt: t.addedAt ?? Date.now(),
    albumName: t.albumName,
    albumArt,
    releaseYear: t.releaseYear,
    albumArtist: t.albumArtist,
    composer: t.composer,
    trackNumber: t.trackNumber,
    discNumber: t.discNumber,
    discCount: t.discCount,
    performers: t.performers,
    producers: t.producers,
    engineers: t.engineers,
    linerNotesUrl: t.linerNotesUrl,
    bookletUrl: t.bookletUrl,
    creditsJson: t.creditsJson,
    trackPerformers: t.trackPerformers,
    trackProducers: t.trackProducers,
    trackSoloists: t.trackSoloists,
    lyrics: t.lyrics,
  };
}

type LockerRow = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  durationSeconds?: number;
  audioBlob?: Blob;
  url?: string;
  albumName?: string;
  albumArt?: string;
  albumArtBlob?: Blob;
  releaseYear?: string;
  albumArtist?: string;
  composer?: string;
  trackNumber?: number;
  discNumber?: number;
  discCount?: string;
  performers?: string;
  producers?: string;
  engineers?: string;
  linerNotesUrl?: string;
  bookletUrl?: string;
  creditsJson?: string;
  trackPerformers?: string;
  trackProducers?: string;
  trackSoloists?: string;
  lyrics?: string;
  addedAt?: number;
};

let lockerCache: LockerEntry[] | null = null;
let lockerLoadPromise: Promise<LockerEntry[]> | null = null;
const lockerListeners = new Set<() => void>();

/** Defer album-art revocation so <img> nodes can swap src before onError fires. */
const ALBUM_ART_REVOKE_DEFER_MS = 600;

function scheduleRevokeAlbumArtUrl(url: string): void {
  if (!url.startsWith('blob:')) return;
  if (typeof window === 'undefined') {
    URL.revokeObjectURL(url);
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), ALBUM_ART_REVOKE_DEFER_MS);
}

function revokeLockerEntryUrls(
  entries: LockerEntry[],
  options?: { deferAlbumArt?: boolean },
): void {
  for (const e of entries) {
    if (e.url.startsWith('blob:')) URL.revokeObjectURL(e.url);
    if (e.albumArt?.startsWith('blob:')) {
      if (options?.deferAlbumArt) scheduleRevokeAlbumArtUrl(e.albumArt);
      else URL.revokeObjectURL(e.albumArt);
    }
  }
}

function notifyLockerCache(): void {
  lockerListeners.forEach((fn) => fn());
}

function revokeEntryBlobUrls(entry: LockerEntry, options?: { deferAlbumArt?: boolean }): void {
  if (entry.url.startsWith('blob:')) URL.revokeObjectURL(entry.url);
  if (entry.albumArt?.startsWith('blob:')) {
    if (options?.deferAlbumArt) scheduleRevokeAlbumArtUrl(entry.albumArt);
    else URL.revokeObjectURL(entry.albumArt);
  }
}

/** Keep in-memory blob URLs stable across refresh so covers do not flash blank. */
function mergeLockerEntries(prev: LockerEntry[] | null, fresh: LockerEntry[]): LockerEntry[] {
  if (!prev?.length) return fresh;

  const prevById = new Map(prev.map((e) => [e.id, e]));
  const nextIds = new Set(fresh.map((e) => e.id));
  const merged: LockerEntry[] = [];

  for (const entry of fresh) {
    const old = prevById.get(entry.id);
    if (!old) {
      merged.push(entry);
      continue;
    }

    const freshUrl = entry.url?.trim() ?? '';
    const oldUrl = old.url?.trim() ?? '';
    // Never resurrect dead blob: play URLs from memory after DB refresh cleared them.
    const url =
      freshUrl ||
      (oldUrl.startsWith('content://') ? oldUrl : '');
    const oldArt = old.albumArt;
    const freshArt = entry.albumArt;
    // Soft refresh re-materializes blob URLs from IndexedDB; keep live in-memory art.
    let albumArt: string | undefined;
    if (freshArt?.startsWith('blob:') && oldArt?.startsWith('blob:')) {
      albumArt = oldArt;
      scheduleRevokeAlbumArtUrl(freshArt);
    } else {
      albumArt = freshArt ?? oldArt;
      if (freshArt && freshArt !== albumArt && freshArt.startsWith('blob:')) {
        scheduleRevokeAlbumArtUrl(freshArt);
      }
      if (oldArt && oldArt !== albumArt && oldArt.startsWith('blob:')) {
        scheduleRevokeAlbumArtUrl(oldArt);
      }
    }

    if (entry.url !== url && entry.url.startsWith('blob:')) {
      URL.revokeObjectURL(entry.url);
    }
    if (old.url !== url && old.url.startsWith('blob:')) {
      URL.revokeObjectURL(old.url);
    }

    merged.push({
      ...entry,
      url,
      albumArt,
      offlineReady: entry.offlineReady ?? old.offlineReady,
    });
  }

  for (const old of prev) {
    if (!nextIds.has(old.id)) revokeEntryBlobUrls(old, { deferAlbumArt: true });
  }

  return merged;
}

function dropCachedAlbumArt(entryId: string): void {
  if (!lockerCache) return;
  const idx = lockerCache.findIndex((e) => e.id === entryId);
  if (idx < 0) return;
  const oldArt = lockerCache[idx].albumArt;
  if (oldArt?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(oldArt);
    } catch {
      /* ignore */
    }
  }
  const next = [...lockerCache];
  next[idx] = { ...next[idx], albumArt: undefined };
  lockerCache = next;
}

function setLockerCache(entries: LockerEntry[], replace = true): LockerEntry[] {
  if (replace && lockerCache) {
    revokeLockerEntryUrls(lockerCache, { deferAlbumArt: true });
  }
  lockerCache = entries;
  notifyLockerCache();
  return entries;
}

/** Synchronous snapshot — instant Locker UI when cache is warm. */
export function getLockerEntriesSnapshot(): LockerEntry[] | null {
  return lockerCache;
}

async function blobObjectUrlIsLive(url: string): Promise<boolean> {
  if (!url.startsWith('blob:')) return Boolean(url.trim());
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** Re-create a revoked cover blob URL from IndexedDB so locker art can recover. */
const albumArtRefreshInFlight = new Map<string, Promise<string | null>>();

export async function refreshLockerEntryAlbumArt(entryId: string): Promise<string | null> {
  const pending = albumArtRefreshInFlight.get(entryId);
  if (pending) return pending;

  const work = (async (): Promise<string | null> => {
    const list = lockerCache ?? (await getLockerEntries());
    const idx = list.findIndex((e) => e.id === entryId);
    if (idx < 0) return null;

    const entry = list[idx];
    const currentArt = entry.albumArt?.trim();

    if (currentArt?.startsWith('blob:') && (await blobObjectUrlIsLive(currentArt))) {
      return currentArt;
    }

    // Prefer a fresh blob URL from IDB — stored https/proxy strings may be stale while blobs exist.
    const artBlob = await readEntryArtBlob(entryId);
    if (artBlob && artBlob.size > 0) {
      if (currentArt?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(currentArt);
        } catch {
          /* ignore */
        }
      }
      const albumArt = URL.createObjectURL(artBlob);
      const next = [...list];
      next[idx] = { ...entry, albumArt };
      lockerCache = next;
      notifyLockerCache();
      return albumArt;
    }
    if (currentArt && isPersistentAlbumArt(currentArt)) return currentArt;

    const row = (await readAllLockerRows()).find((r) => r.id === entryId);
    const fallback = row ? resolveAlbumArtForRow(row) : undefined;
    if (fallback && !fallback.startsWith('blob:')) return fallback;

    const albumKey = lockerAlbumGroupKey(entry);
    if (albumKey) {
      const siblings = list.filter(
        (row) => row.id !== entryId && lockerAlbumGroupKey(row) === albumKey,
      );
      for (const sibling of siblings) {
        const siblingArt = sibling.albumArt?.trim();
        if (siblingArt?.startsWith('blob:') && (await blobObjectUrlIsLive(siblingArt))) {
          return siblingArt;
        }
        if (siblingArt && isPersistentAlbumArt(siblingArt)) return siblingArt;
        const siblingBlob = await readEntryArtBlob(sibling.id);
        if (siblingBlob && siblingBlob.size > 0) {
          return URL.createObjectURL(siblingBlob);
        }
      }
    }
    return null;
  })();

  albumArtRefreshInFlight.set(entryId, work);
  try {
    return await work;
  } finally {
    albumArtRefreshInFlight.delete(entryId);
  }
}

/** Re-create a revoked blob URL from IndexedDB so local playback can recover. */
export async function refreshLockerEntryPlayUrl(entryId: string): Promise<string | null> {
  const list = lockerCache ?? (await getLockerEntries());
  const idx = list.findIndex((e) => e.id === entryId);
  if (idx < 0) return null;

  const entry = list[idx];
  const blob = await readEntryAudioBlob(entryId);
  if (!blob || blob.size <= 0) return null;

  if (entry.url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch {
      /* ignore */
    }
  }

  const url = URL.createObjectURL(blob);
  const next = [...list];
  next[idx] = { ...entry, url };
  lockerCache = next;
  notifyLockerCache();
  return url;
}

/**
 * Resolve a locker track to a playable envelope — re-match by metadata when ids are stale,
 * refresh blob URLs, and on Android register native content:// URIs for ExoPlayer.
 */
export async function resolveLockerEnvelopeForPlayback(
  hint: Pick<
    MediaEnvelope,
    | 'sourceId'
    | 'title'
    | 'artist'
    | 'album'
    | 'envelopeId'
    | 'artworkUrl'
    | 'durationSeconds'
    | 'releaseYear'
    | 'replayGainDb'
  > & { provider?: MediaEnvelope['provider']; transport?: MediaEnvelope['transport']; url?: string },
): Promise<MediaEnvelope | null> {
  const entries = await getLockerEntries();

  const tryEntry = async (entry: LockerEntry): Promise<MediaEnvelope | null> => {
    const artUrl =
      (await resolveLockerArtworkUrl(entry.id)) ?? entry.albumArt ?? hint.artworkUrl;
    const base: Omit<MediaEnvelope, 'url'> = {
      envelopeId: `local-${entry.id}`,
      title: entry.title,
      artist: entry.artist,
      album: entry.albumName ?? hint.album,
      durationSeconds: entry.durationSeconds || hint.durationSeconds || 0,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: entry.id,
      artworkUrl: artUrl,
      releaseYear: entry.releaseYear ?? hint.releaseYear,
      replayGainDb: hint.replayGainDb,
    };

    if (isAndroid()) {
      const healed = await healLockerEntryNativePlayback(entry.id);
      if (healed) return { ...base, url: healed };
      return null;
    }

    const blob = await getLockerAudioBlob(entry.id);
    if (!blob || blob.size <= 0) return null;

    const url = await refreshLockerEntryPlayUrl(entry.id);
    if (!url) return null;

    return { ...base, url };
  };

  const metaCandidates = (): LockerEntry[] => {
    const titleMatches = entries.filter((e) => lockerTitleMatches(e.title, hint.title));
    if (titleMatches.length === 0) return [];

    const albumKey = hint.album?.trim() ? normalizeLockerFuzzyKey(hint.album) : null;
    let pool = titleMatches;
    if (albumKey) {
      const albumMatches = titleMatches.filter((e) =>
        lockerAlbumMatches(e.albumName ?? '', hint.album ?? ''),
      );
      if (albumMatches.length > 0) pool = albumMatches;
    } else {
      const artistMatches = titleMatches.filter((e) =>
        lockerArtistMatches(e.artist, hint.artist),
      );
      if (artistMatches.length > 0) pool = artistMatches;
    }
    return [...pool].sort((a, b) => b.addedAt - a.addedAt);
  };

  const sourceId = hint.sourceId?.replace(/^local-/, '').trim();
  if (sourceId) {
    const byId = entries.find((e) => e.id === sourceId);
    if (byId) {
      const resolved = await tryEntry(byId);
      if (resolved) return resolved;
    }
  }

  const byMetaList = metaCandidates();
  const playableFirst: LockerEntry[] = [];
  const rest: LockerEntry[] = [];
  for (const entry of byMetaList) {
    if (await lockerEntryIsPlayable(entry.id)) playableFirst.push(entry);
    else rest.push(entry);
  }
  for (const entry of [...playableFirst, ...rest]) {
    const resolved = await tryEntry(entry);
    if (resolved) return resolved;
  }

  return null;
}

export async function lockerEntryHasAudio(entryId: string): Promise<boolean> {
  const blob = await getLockerAudioBlob(entryId);
  return Boolean(blob && blob.size > 0);
}

type LockerRowHealHint = {
  hasAudioBlob?: boolean;
  nativeAudioCached?: boolean;
  nativeSourcePath?: string;
};

/** True when audio bytes are likely on-device (healing runs at playback time, not vault load). */
export async function lockerEntryHasRecoverableAudio(
  entryId: string,
  options?: { skipNativeProbe?: boolean },
): Promise<boolean> {
  const id = entryId.trim().replace(/^local-/, '');
  if (!id) return false;
  // Only trust readable bytes or a live native Exo cache — never stale path/key hints.
  if (await lockerEntryHasAudio(id)) return true;
  const row = await readLockerRowById(id);
  if (row) {
    const sourcePath = typeof row.nativeSourcePath === 'string' ? row.nativeSourcePath.trim() : '';
    if (
      sourcePath &&
      (isStableNativeAudioPath(sourcePath) || /\/ytdlp-locker\//i.test(sourcePath))
    ) {
      return true;
    }
  }
  if (options?.skipNativeProbe) return false;
  if (isAndroid()) {
    const { probeNativeLockerContentUri } = await import('./nativeExoLockerBridge');
    if (await probeNativeLockerContentUri(id)) return true;
  }
  return false;
}

/** Boot-safe playability — metadata / blob-store keys only (no IDB audio reads, no native bridge). */
function lockerEntryFastPlayable(
  entry: LockerEntry,
  blobIds: Set<string>,
  hint?: LockerRowHealHint,
): boolean {
  if (blobIds.has(entry.id)) return true;
  const url = entry.url?.trim() ?? '';
  if (url.startsWith('content://') || url.startsWith('blob:')) return true;
  if (hint) {
    return lockerRowHasHealSignals(
      {
        id: entry.id,
        hasAudioBlob: hint.hasAudioBlob,
        nativeAudioCached: hint.nativeAudioCached,
        nativeSourcePath: hint.nativeSourcePath,
      },
      blobIds,
    );
  }
  return false;
}

/** True when a locker row still has metadata heal signals (avoid mass re-download on boot). */
export async function lockerEntryHasHealSignals(entryId: string): Promise<boolean> {
  const id = entryId.trim().replace(/^local-/, '');
  if (!id) return false;
  if (await lockerEntryHasRecoverableAudio(id)) return true;
  const row = await readLockerRowById(id);
  if (!row) return false;
  const blobIds = await ensureBlobStoreIdCache();
  return lockerRowHasHealSignals(row, blobIds);
}

/** IndexedDB blob or Android native content:// cache — required for Exo locker play. */
export async function lockerEntryIsPlayable(entryId: string): Promise<boolean> {
  return lockerEntryHasRecoverableAudio(entryId);
}

function resolveLockerPlayabilityMode(
  mode?: LockerPlayabilityMode,
): LockerPlayabilityMode {
  if (mode) return mode;
  return isBootUiInteractive() ? 'full' : 'fast';
}

/** Stamp offlineReady on vault entries so UI never trusts stale blob: URLs. */
export async function enrichLockerEntriesPlayability(
  entries: LockerEntry[],
  options?: { mode?: LockerPlayabilityMode; rowHints?: Map<string, LockerRowHealHint> },
): Promise<LockerEntry[]> {
  const mode = resolveLockerPlayabilityMode(options?.mode);
  const blobIds =
    options?.mode === 'fast' && options?.rowHints
      ? (cachedBlobStoreIds ?? new Set<string>())
      : await ensureBlobStoreIdCache();
  const rowHints = options?.rowHints;
  const out: LockerEntry[] = [];
  const { yieldToMain } = await import('./yieldToMain');
  let idx = 0;

  for (const entry of entries) {
    const ready =
      mode === 'fast'
        ? lockerEntryFastPlayable(entry, blobIds, rowHints?.get(entry.id))
        : (await lockerEntryHasAudio(entry.id)) ||
          lockerEntryFastPlayable(entry, blobIds, rowHints?.get(entry.id));
    let url = entry.url;
    if (!ready && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      url = '';
    }
    out.push({ ...entry, url, offlineReady: ready });
    idx += 1;
    if (mode === 'full' && idx % 24 === 0) await yieldToMain();
  }
  return out;
}

/** Locker UI and browse lists only include rows with real playable audio bytes. */
export function filterPlayableLockerEntries(entries: LockerEntry[]): LockerEntry[] {
  return entries.filter((entry) => entry.offlineReady === true);
}

/** True when a row might still be healed (IDB blob, native cache path, or blob-store key). */
export function lockerRowHasHealSignals(
  row: Record<string, unknown>,
  blobIds?: Set<string>,
): boolean {
  const id = String(row.id ?? '').trim();
  if (blobIds?.has(id)) return true;
  if (row.hasAudioBlob === true) return true;
  if (row.nativeAudioCached === true) return true;
  const sourcePath = typeof row.nativeSourcePath === 'string' ? row.nativeSourcePath.trim() : '';
  if (sourcePath && isStableNativeAudioPath(sourcePath)) return true;
  return false;
}

/** Stamp offlineReady on every vault row — never drop rows from the in-memory cache. */
async function finalizeLockerCacheEntries(
  entries: LockerEntry[],
  options?: {
    playabilityMode?: LockerPlayabilityMode;
    rowHints?: Map<string, LockerRowHealHint>;
  },
): Promise<LockerEntry[]> {
  const playable = await enrichLockerEntriesPlayability(entries, {
    mode: options?.playabilityMode,
    rowHints: options?.rowHints,
  });
  return inheritLockerAlbumArt(playable);
}

/** After first interaction — full native / IDB playability pass (background). */
export async function refreshLockerPlayabilityFull(): Promise<LockerEntry[]> {
  if (!lockerCache?.length) return lockerCache ?? [];
  const finalized = await finalizeLockerCacheEntries(lockerCache, { playabilityMode: 'full' });
  return setLockerCache(finalized);
}

/**
 * HARD RULE: never delete locker tracks or audio blobs.
 * Previously removed metadata-only rows; that path is permanently disabled.
 * Use recoverOrphanedLockerBlobs / warmLockerNativePlaybackCache instead.
 */
export async function pruneHollowLockerEntriesFromStorage(): Promise<number> {
  const { blockLockerAutoDelete } = await import('./lockerDeleteGuard');
  blockLockerAutoDelete('pruneHollowLockerEntriesFromStorage');
  if (isAndroid()) {
    await warmLockerNativePlaybackCache();
  }
  console.info(
    '[locker] pruneHollowLockerEntriesFromStorage skipped — never delete locker rows',
  );
  return 0;
}

/** Rows + heal signals for boot integrity verification — never deletes. */
export async function readLockerEntriesForDurability(): Promise<
  Array<LockerEntry & { hasAudioBlob?: boolean; nativeSourcePath?: string }>
> {
  const rows = await readAllLockerRows();
  return rows.map((row) => {
    const rec = row as Record<string, unknown>;
    return {
      id: String(row.id),
      title: String(row.title ?? ''),
      artist: String(row.artist ?? ''),
      genre: String(row.genre ?? 'Local'),
      durationSeconds: Number(row.durationSeconds ?? 0),
      url: String(row.url ?? ''),
      addedAt: Number(row.addedAt ?? 0),
      albumName: row.albumName,
      albumArt: row.albumArt,
      releaseYear: row.releaseYear,
      albumArtist: row.albumArtist,
      offlineReady: rec.offlineReady === true,
      hasAudioBlob: rec.hasAudioBlob === true,
      nativeSourcePath:
        typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath : undefined,
    };
  });
}

/** Mark missing-audio row hollow — metadata stays for re-download. */
export async function markLockerEntryHollow(id: string): Promise<void> {
  const trackId = id.trim();
  if (!trackId) return;
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(trackId);
    getReq.onsuccess = () => {
      const row = getReq.result as Record<string, unknown> | undefined;
      if (!row) {
        resolve();
        return;
      }
      row.hasAudioBlob = false;
      row.offlineReady = false;
      if (typeof row.url === 'string' && row.url.startsWith('blob:')) {
        delete row.url;
      }
      store.put(row);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (cachedBlobStoreIds) cachedBlobStoreIds.delete(trackId);
  await refreshLockerCache({ hard: true });
}

export type LockerVaultHealthReport = {
  trackRows: number;
  blobStoreKeys: number;
  orphanedBlobs: number;
  playableTracks: number;
  healableTracks: number;
  metadataOnlyTracks: number;
};

/** Honest vault audit — total rows vs playable vs recoverable vs lost metadata. */
export async function auditLockerVaultHealth(): Promise<LockerVaultHealthReport> {
  const blobIds = await readAllBlobStoreIds();
  const blobIdSet = new Set(blobIds);
  const rows = await readAllLockerRows();
  const rowIds = new Set(rows.map((r) => r.id));
  let orphanedBlobs = 0;
  for (const id of blobIds) {
    if (!rowIds.has(id)) orphanedBlobs += 1;
  }

  let playableTracks = 0;
  let healableTracks = 0;
  let metadataOnlyTracks = 0;

  for (const row of rows) {
    const healSignals = lockerRowHasHealSignals(row as Record<string, unknown>, blobIdSet);
    if (await lockerEntryIsPlayable(row.id)) {
      playableTracks += 1;
      continue;
    }
    if (healSignals) {
      healableTracks += 1;
      continue;
    }
    metadataOnlyTracks += 1;
  }

  return {
    trackRows: rows.length,
    blobStoreKeys: blobIds.length,
    orphanedBlobs,
    playableTracks,
    healableTracks,
    metadataOnlyTracks,
  };
}

/** Re-link track metadata from orphaned IDB blob-store keys (Repair Locker). */
export async function recoverOrphanedLockerBlobs(): Promise<number> {
  return healLockerMetadataFromBlobStore();
}

function normLockerMatch(value: string): string {
  return value.trim().toLowerCase();
}

/** Fuzzy key — matches playlist import / rematch (¥$, punctuation, partial titles, accents). */
export function normalizeLockerFuzzyKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function lockerTitleMatches(a: string, b: string): boolean {
  const ak = normalizeLockerFuzzyKey(a);
  const bk = normalizeLockerFuzzyKey(b);
  if (!ak || !bk) return false;
  return ak === bk || ak.includes(bk) || bk.includes(ak);
}

export function lockerArtistMatches(a: string, b: string): boolean {
  const aa = a.trim();
  const ba = b.trim();
  if (!aa && !ba) return true;
  if (!aa || !ba) return false;
  const ak = normalizeLockerFuzzyKey(aa);
  const bk = normalizeLockerFuzzyKey(ba);
  if (!bk) return aa.toLowerCase().includes(ba.toLowerCase());
  if (!ak) return ba.toLowerCase().includes(aa.toLowerCase());
  return ak === bk || ak.includes(bk) || bk.includes(ak);
}

/** Edition markers that must not cross-match (nightcore vs standard, etc.). */
const LOCKER_ALBUM_EDITION_RE =
  /\b(nightcore|sped up|slowed|instrumental|deluxe|remaster(?:ed)?|anniversary|bonus|expanded|acoustic|live|demo|karaoke)\b/;

/** Album match — rejects edition traps like american dream vs american dream nightcore version. */
export function lockerAlbumMatches(a: string, b: string): boolean {
  const ak = normalizeLockerFuzzyKey(a);
  const bk = normalizeLockerFuzzyKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  const aEd = LOCKER_ALBUM_EDITION_RE.test(ak);
  const bEd = LOCKER_ALBUM_EDITION_RE.test(bk);
  if (aEd !== bEd) return false;
  return ak.includes(bk) || bk.includes(ak);
}

/** Newest locker row with real audio bytes (skips metadata-only orphans). */
export async function findPlayableLockerEntryForTrack(
  title: string,
  artist: string,
  albumName?: string,
  entries?: LockerEntry[] | null,
): Promise<LockerEntry | null> {
  const list = entries ?? lockerCache ?? (await getLockerEntries());
  if (list.length === 0) return null;

  const titleMatches = list.filter((e) => lockerTitleMatches(e.title, title));
  if (titleMatches.length === 0) return null;

  const albumKey = albumName?.trim() ? normalizeLockerFuzzyKey(albumName) : null;
  let pool = titleMatches;
  if (albumKey) {
    const albumMatches = titleMatches.filter((e) =>
      lockerAlbumMatches(e.albumName ?? '', albumName ?? ''),
    );
    if (albumMatches.length === 0) return null;
    pool = albumMatches;
  } else {
    const artistMatches = titleMatches.filter((e) => lockerArtistMatches(e.artist, artist));
    if (artistMatches.length > 0) pool = artistMatches;
  }

  const ordered = [...pool].sort((a, b) => b.addedAt - a.addedAt);
  for (const entry of ordered) {
    if (await lockerEntryIsPlayable(entry.id)) return entry;
  }
  return null;
}

function lockerTrackMatchPool(
  title: string,
  artist: string,
  albumName: string | undefined,
  list: LockerEntry[],
): LockerEntry[] {
  const titleMatches = list.filter((e) => lockerTitleMatches(e.title, title));
  if (titleMatches.length === 0) return [];

  const albumKey = albumName?.trim() ? normalizeLockerFuzzyKey(albumName) : null;
  if (albumKey) {
    const albumMatches = titleMatches.filter((e) =>
      lockerAlbumMatches(e.albumName ?? '', albumName ?? ''),
    );
    return albumMatches;
  }

  const artistMatches = titleMatches.filter((e) => lockerArtistMatches(e.artist, artist));
  return artistMatches.length > 0 ? artistMatches : titleMatches;
}

/**
 * Match locker rows by title/artist even when audio is hollow — for in-place re-download.
 * Prefers hollow rows so re-acquisition replaces the dead entry instead of adding a sibling.
 */
export function findLockerEntryForTrackIncludingHollow(
  title: string,
  artist: string,
  albumName?: string,
  entries?: LockerEntry[] | null,
): LockerEntry | null {
  const list = entries ?? lockerCache ?? [];
  if (list.length === 0) return null;

  const pool = lockerTrackMatchPool(title, artist, albumName, list);
  if (pool.length === 0) return null;

  const ordered = [...pool].sort((a, b) => {
    const aHollow = a.offlineReady === false ? 1 : 0;
    const bHollow = b.offlineReady === false ? 1 : 0;
    if (aHollow !== bHollow) return bHollow - aHollow;
    return b.addedAt - a.addedAt;
  });
  return ordered[0] ?? null;
}

/** Existing hollow locker row to overwrite when re-downloading dead audio. */
export async function resolveLockerReacquireTargetId(
  title: string,
  artist: string,
  albumName?: string,
): Promise<string | undefined> {
  if (await findPlayableLockerEntryForTrack(title, artist, albumName)) return undefined;
  return findLockerEntryForTrackIncludingHollow(title, artist, albumName)?.id;
}

/** Remove metadata-only duplicates when a playable copy exists for the same title+artist. */
/**
 * HARD RULE: never delete locker tracks.
 * Previously removed metadata-only duplicates when a playable sibling existed.
 * Dedupe is display-only via dedupeLockerEntriesForDisplay — rows stay in the vault.
 */
export async function pruneMetadataOnlyLockerDuplicates(): Promise<number> {
  const { blockLockerAutoDelete } = await import('./lockerDeleteGuard');
  blockLockerAutoDelete('pruneMetadataOnlyLockerDuplicates');
  console.info(
    '[locker] pruneMetadataOnlyLockerDuplicates skipped — never delete locker rows',
  );
  return 0;
}

let cachedBlobStoreIds: Set<string> | null = null;
let blobStoreIdCachePromise: Promise<Set<string>> | null = null;

/** Cached track_blobs keys — avoids per-row IDB reads during vault playability stamp. */
export async function refreshBlobStoreIdCache(): Promise<Set<string>> {
  const ids = await readAllBlobStoreIds();
  cachedBlobStoreIds = new Set(ids);
  return cachedBlobStoreIds;
}

async function ensureBlobStoreIdCache(): Promise<Set<string>> {
  if (cachedBlobStoreIds) return cachedBlobStoreIds;
  if (!blobStoreIdCachePromise) {
    blobStoreIdCachePromise = refreshBlobStoreIdCache().finally(() => {
      blobStoreIdCachePromise = null;
    });
  }
  return blobStoreIdCachePromise;
}

async function readAllBlobStoreIds(): Promise<string[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
    const req = tx.objectStore(BLOB_STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBlobStoreEntry(id: string): Promise<void> {
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
      resolve();
      return;
    }
    const tx = db.transaction(BLOB_STORE_NAME, 'readwrite');
    tx.objectStore(BLOB_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearHollowLockerRow(id: string): Promise<void> {
  const db = await initDB();
  const current = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const getReq = tx.objectStore(STORE_NAME).get(id);
    getReq.onsuccess = () => resolve(getReq.result as Record<string, unknown> | undefined);
    getReq.onerror = () => reject(getReq.error);
  });

  if (current?.nativeAudioCached === true) {
    const sourcePath =
      typeof current.nativeSourcePath === 'string' ? current.nativeSourcePath.trim() : '';
    if (sourcePath && isStableNativeAudioPath(sourcePath) && isAndroid()) {
      const { registerLockerBlobFromFileUri, probeNativeLockerContentUri } = await import(
        './nativeExoLockerBridge'
      );
      await registerLockerBlobFromFileUri(id, sourcePath).catch(() => null);
      if (await probeNativeLockerContentUri(id)) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(id);
          getReq.onsuccess = () => {
            const row = getReq.result as Record<string, unknown> | undefined;
            if (row) {
              row.hasAudioBlob = true;
              store.put(row);
            }
          };
          getReq.onerror = () => reject(getReq.error);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return;
      }
    }
    // Keep native-download metadata visible even if the temp file was already consumed.
    return;
  }

  await deleteBlobStoreEntry(id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result as Record<string, unknown> | undefined;
      if (!current) {
        resolve();
        return;
      }
      current.hasAudioBlob = false;
      if (typeof current.url === 'string' && current.url.startsWith('blob:')) {
        delete current.url;
      }
      store.put(current);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Re-link tracks metadata when audio bytes exist in track_blobs but flags/rows were cleared.
 */
export async function healLockerMetadataFromBlobStore(
  options?: Pick<LockerReconcileOptions, 'deleteEmptyBlobs'>,
): Promise<number> {
  const deleteEmptyBlobs = options?.deleteEmptyBlobs === true;
  const blobIds = await readAllBlobStoreIds();
  if (blobIds.length === 0) return 0;

  const db = await initDB();
  const rawRows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as Record<string, unknown>[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  const byId = new Map(rawRows.map((r) => [String(r.id), r]));

  let mirrorById = new Map<string, { title: string; artist: string; albumName?: string }>();
  try {
    const { listLockerMirrorTracks } = await import('./lockerMirror');
    const mirrorHits = await listLockerMirrorTracks(2000);
    mirrorById = new Map(
      mirrorHits.map((h) => [h.id, { title: h.title, artist: h.artist, albumName: h.albumName }]),
    );
  } catch {
    /* optional */
  }

  let healed = 0;

  for (const id of blobIds) {
    const blob = await getLockerAudioBlob(id);
    if (!blob || blob.size <= 0) {
      if (deleteEmptyBlobs) await deleteBlobStoreEntry(id);
      continue;
    }
    const existing = byId.get(id);
    const mirror = mirrorById.get(id);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const base: Record<string, unknown> = existing
        ? { ...existing }
        : {
            id,
            title: mirror?.title ?? 'Recovered Track',
            artist: mirror?.artist ?? 'Locker',
            genre: 'Local',
            durationSeconds: 0,
            addedAt: Date.now(),
            albumName: mirror?.albumName,
          };
      base.hasAudioBlob = true;
      if (typeof base.url === 'string' && (base.url as string).startsWith('blob:')) {
        delete base.url;
      }
      store.put(base);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    healed += 1;
  }

  if (healed > 0) {
    await refreshLockerCache({ hard: true });
    console.info('[locker] healed metadata from blob store', { healed, blobIds: blobIds.length });
  }
  return healed;
}

export type LockerBlobIntegrityReport = {
  trackRows: number;
  blobStoreKeys: number;
  playable: number;
  clearedFalseFlags: number;
  healedFromBlobs: number;
};

/** Fix hasAudioBlob flags that lie about missing bytes; heal rows from blob store when needed. */
export async function reconcileLockerBlobIntegrity(
  options?: LockerReconcileOptions,
): Promise<LockerBlobIntegrityReport> {
  const { assertLockerRepairDestructiveAllowed } = await import('./lockerDeleteGuard');
  assertLockerRepairDestructiveAllowed(options);
  const clearHollowRows = options?.clearHollowRows === true;
  const healedFromBlobs = await healLockerMetadataFromBlobStore({
    deleteEmptyBlobs: options?.deleteEmptyBlobs === true,
  });
  const blobStoreKeys = (await readAllBlobStoreIds()).length;
  const blobIdSet = new Set(await readAllBlobStoreIds());

  if (isAndroid() && !options?.skipNativeWarm) {
    await warmLockerNativePlaybackCache();
  }

  let clearedFalseFlags = 0;
  if (clearHollowRows) {
    const allRows = await readAllLockerRows();
    for (const row of allRows) {
      const id = row.id;
      if (await lockerEntryIsPlayable(id)) continue;
      if (lockerRowHasHealSignals(row as Record<string, unknown>, blobIdSet)) continue;
      const hasFlag = Boolean((row as { hasAudioBlob?: boolean }).hasAudioBlob);
      const hasUrl = Boolean(row.url?.trim());
      if (!hasFlag && !hasUrl) continue;
      await clearHollowLockerRow(id);
      clearedFalseFlags += 1;
    }
  }

  if (clearedFalseFlags > 0) {
    console.info('[locker] cleared hollow locker rows', { clearedFalseFlags });
  }

  const { entries: refreshed, rowHints } = await readLockerEntriesFromDb();
  const finalEntries = await finalizeLockerCacheEntries(refreshed, { rowHints });
  lockerCache = finalEntries;
  notifyLockerCache();
  const playable = finalEntries.filter((e) => e.offlineReady === true).length;

  return {
    trackRows: finalEntries.length,
    blobStoreKeys,
    playable,
    clearedFalseFlags,
    healedFromBlobs,
  };
}

/** E2E / diagnostics — log locker rows vs readable audio bytes. */
export async function dumpLockerPlayabilityDiagnostics(): Promise<string> {
  const blobIds = await readAllBlobStoreIds();
  const entries = await getLockerEntries();
  const lines: string[] = [
    `entries=${entries.length}`,
    `blobStoreKeys=${blobIds.length}`,
  ];
  let playable = 0;
  const { yieldToMain } = await import('./yieldToMain');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.offlineReady === true) {
      playable += 1;
      continue;
    }
    if (await lockerEntryHasRecoverableAudio(entry.id, { skipNativeProbe: true })) {
      playable += 1;
    }
    if (i > 0 && i % 48 === 0) await yieldToMain();
  }
  for (const id of blobIds.slice(0, 12)) {
    const blob = await getLockerAudioBlob(id);
    const bytes = blob?.size ?? 0;
    const entry = entries.find((e) => e.id === id);
    const label = entry ? `${entry.title}|${entry.artist}` : 'no-meta';
    let rawType = '';
    let trackFlags = '';
    try {
      const db = await initDB();
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
        const req = tx.objectStore(BLOB_STORE_NAME).get(id);
        req.onsuccess = () => resolve((req.result as { audioBlob?: unknown })?.audioBlob);
        req.onerror = () => reject(req.error);
      });
      rawType = raw == null ? 'null' : raw instanceof Blob ? `Blob:${(raw as Blob).size}` : typeof raw;
      const trackRow = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
        req.onerror = () => reject(req.error);
      });
      if (trackRow) {
        const inline = trackRow.audioBlob;
        const inlineDesc =
          inline == null
            ? 'inline=null'
            : inline instanceof Blob
              ? `inline=Blob:${inline.size}`
              : `inline=${typeof inline}`;
        trackFlags = `hasAudioBlob=${String(trackRow.hasAudioBlob)} ${inlineDesc}`;
      }
    } catch {
      rawType = 'err';
    }
    lines.push(`${label}|id=${id}|bytes=${bytes}|raw=${rawType}|${trackFlags}`);
  }
  lines.push(`playable=${playable}`);
  return lines.join(' ');
}

async function persistBlobToBlobStore(id: string, blob: Blob): Promise<void> {
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const blobStore = tx.objectStore(BLOB_STORE_NAME);
    const trackStore = tx.objectStore(STORE_NAME);
    blobStore.put({ id, audioBlob: blob } satisfies TrackBlobRow);
    const getReq = trackStore.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result as Record<string, unknown> | undefined;
      if (row) {
        row.hasAudioBlob = true;
        if (typeof row.url === 'string' && row.url.startsWith('blob:')) {
          delete row.url;
        }
        trackStore.put(row);
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (cachedBlobStoreIds) cachedBlobStoreIds.add(id);
}

async function persistFileUriToBlobStore(id: string, fileUri: string): Promise<boolean> {
  try {
    let readUri = fileUri.trim();
    if (!readUri) return false;
    if (isAndroid() && /^file:\/\//i.test(readUri)) {
      const { Capacitor } = await import('@capacitor/core');
      const path = decodeURIComponent(readUri.replace(/^file:\/\//i, ''));
      readUri = Capacitor.convertFileSrc(path);
    }
    const res = await fetch(readUri);
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size <= 0) return false;
    await persistBlobToBlobStore(id, blob);
    return true;
  } catch {
    return false;
  }
}

/** Re-import locker audio from durable yt-dlp file paths when native cache was evicted. */
export async function repairDurableNativeSourcePaths(): Promise<number> {
  if (!isAndroid()) return 0;
  const { registerLockerBlobFromFileUri, probeNativeLockerContentUri } = await import(
    './nativeExoLockerBridge'
  );
  const rows = await readAllLockerRows();
  let repaired = 0;
  const { yieldToMain } = await import('./yieldToMain');
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const path = typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath.trim() : '';
    if (!id || !path || !isStableNativeAudioPath(path)) continue;
    if (await probeNativeLockerContentUri(id)) continue;
    const imported = await registerLockerBlobFromFileUri(id, path);
    if (imported?.contentUri) repaired += 1;
    await yieldToMain();
  }
  if (repaired > 0) {
    console.info('[locker] repaired native cache from durable file paths', { repaired });
  }
  return repaired;
}

/** Backfill track_blobs from durable yt-dlp file paths when metadata lost IDB bytes. */
export async function backfillLockerBlobStoreFromNativePaths(): Promise<number> {
  const blobIds = await ensureBlobStoreIdCache();
  const rows = await readAllLockerRows();
  let backfilled = 0;
  const { yieldToMain } = await import('./yieldToMain');
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    if (!id || blobIds.has(id)) continue;
    const path = typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath.trim() : '';
    if (!path || !isImportableLockerNativePath(path)) continue;
    if (await persistFileUriToBlobStore(id, path)) {
      backfilled += 1;
      blobIds.add(id);
    }
    await yieldToMain();
  }
  if (backfilled > 0) {
    console.info('[locker] backfilled blob store from native file paths', { backfilled });
  }
  return backfilled;
}

/**
 * Import ytdlp-locker temps into track_blobs for hollow rows — prevents albums vanishing
 * when download finished on disk but IDB bytes were never copied before app close.
 */
export async function healHollowRowsFromYtdlpTemps(): Promise<number> {
  if (!isAndroid()) return 0;
  const blobIds = await ensureBlobStoreIdCache();
  const rows = await readAllLockerRows();
  let healed = 0;
  const { yieldToMain } = await import('./yieldToMain');
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    if (!id || blobIds.has(id)) continue;
    const path = typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath.trim() : '';
    if (!path || !/\/ytdlp-locker\//i.test(path)) continue;
    if (await persistFileUriToBlobStore(id, path)) {
      healed += 1;
      blobIds.add(id);
      await healLockerEntryNativePlayback(id);
    }
    await yieldToMain();
  }
  if (healed > 0) {
    console.info('[locker] healed hollow rows from ytdlp-locker temps', { healed });
  }
  return healed;
}

/** Clear stale content:// cache pointers saved as nativeSourcePath (pre-v48 bug). */
export async function repairStaleLockerNativeSourcePaths(): Promise<number> {
  const rows = await readAllLockerRows();
  let fixed = 0;
  const db = await initDB();
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? '').trim();
    const path = typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath.trim() : '';
    if (!id || !isLockerCacheContentUri(path)) continue;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result as Record<string, unknown> | undefined;
        if (current && 'nativeSourcePath' in current) {
          delete current.nativeSourcePath;
          store.put(current);
          fixed += 1;
        }
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  if (fixed > 0) {
    console.info('[locker] cleared stale content:// nativeSourcePath rows', { fixed });
  }
  return fixed;
}

/** Copy IDB locker blobs into Android content:// cache so Exo can play offline. */
export async function warmLockerNativePlaybackCache(): Promise<number> {
  if (!isAndroid()) return 0;
  await repairStaleLockerNativeSourcePaths();
  const entries = await getLockerEntries();
  let warmed = 0;
  const { yieldToMain } = await import('./yieldToMain');
  for (const entry of entries) {
    if (!(await lockerEntryHasRecoverableAudio(entry.id))) continue;
    const uri = await healLockerEntryNativePlayback(entry.id);
    if (uri) warmed += 1;
    await yieldToMain();
  }
  if (warmed > 0) {
    console.info('[locker] warmed native playback cache', { warmed, total: entries.length });
  }
  return warmed;
}

/** One row per title+artist in UI — prefer newest playable copy; show hollow rows when no playable copy exists. */
export function dedupeLockerEntriesForDisplay(entries: LockerEntry[]): LockerEntry[] {
  const groups = new Map<string, LockerEntry[]>();
  for (const entry of entries) {
    const key = `${normalizeLockerFuzzyKey(entry.title)}|${normalizeLockerFuzzyKey(entry.artist)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  const out: LockerEntry[] = [];
  for (const group of groups.values()) {
    const playableInGroup = group.filter((e) => e.offlineReady === true);
    const pool = playableInGroup.length > 0 ? playableInGroup : group;
    const sorted = [...pool].sort((a, b) => b.addedAt - a.addedAt);
    out.push(sorted[0]!);
  }
  return out.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (titleCmp !== 0) return titleCmp;
    return a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
  });
}

/** Find a locker row matching catalog metadata (title + artist or album). */
export function findLockerEntryForTrack(
  title: string,
  artist: string,
  albumName?: string,
  entries?: LockerEntry[] | null,
): LockerEntry | null {
  const list = filterPlayableLockerEntries(entries ?? lockerCache ?? []);
  if (list.length === 0) return null;

  const titleMatches = list.filter((e) => lockerTitleMatches(e.title, title));
  if (titleMatches.length === 0) return null;

  const albumKey = albumName?.trim() ? normalizeLockerFuzzyKey(albumName) : null;
  if (albumKey) {
    const albumMatches = titleMatches.filter((e) =>
      lockerAlbumMatches(e.albumName ?? '', albumName ?? ''),
    );
    if (albumMatches.length > 0) {
      return [...albumMatches].sort((a, b) => b.addedAt - a.addedAt)[0] ?? null;
    }
  }

  const artistMatches = titleMatches.filter((e) => lockerArtistMatches(e.artist, artist));
  const pool = artistMatches.length > 0 ? artistMatches : titleMatches;
  return [...pool].sort((a, b) => b.addedAt - a.addedAt)[0] ?? null;
}

export function subscribeLockerCache(listener: () => void): () => void {
  lockerListeners.add(listener);
  return () => lockerListeners.delete(listener);
}

async function readLockerEntriesFromDb(options?: {
  skipArtBlobPreload?: boolean;
}): Promise<{ entries: LockerEntry[]; rowHints: Map<string, LockerRowHealHint> }> {
  const db = await initDB();
  const rows = await new Promise<LockerRow[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as LockerRow[]);
    req.onerror = () => reject(req.error);
  });

  const rowHints = new Map<string, LockerRowHealHint>();
  for (const row of rows) {
    const rec = row as LockerRow & {
      hasAudioBlob?: boolean;
      nativeAudioCached?: boolean;
      nativeSourcePath?: string;
    };
    rowHints.set(rec.id, {
      hasAudioBlob: rec.hasAudioBlob === true,
      nativeAudioCached: rec.nativeAudioCached === true,
      nativeSourcePath:
        typeof rec.nativeSourcePath === 'string' ? rec.nativeSourcePath : undefined,
    });
  }

  const artBlobs = new Map<string, Blob>();
  if (!options?.skipArtBlobPreload && db.objectStoreNames.contains(BLOB_STORE_NAME)) {
    const blobRows = await new Promise<TrackBlobRow[]>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
      const req = tx.objectStore(BLOB_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as TrackBlobRow[]);
      req.onerror = () => reject(req.error);
    });
    for (const row of blobRows) {
      const blob = storedArtToBlob(row.albumArtBlob);
      if (blob) artBlobs.set(row.id, blob);
    }
  }

  const entries = rows
    .map((t) => {
      const albumArtBlob = artBlobs.get(t.id) ?? t.albumArtBlob;
      return rowToEntry({ ...t, albumArtBlob });
    })
    .filter((e): e is LockerEntry => e !== null);

  return { entries, rowHints };
}

/** Preload vault once at app start so Locker never cold-starts empty. */
export function warmLockerCache(): Promise<LockerEntry[]> {
  return getLockerEntries();
}

/** Force re-read from IndexedDB (after uploads, edits, deletes). */
export async function refreshLockerCache(options?: {
  hard?: boolean;
  playabilityMode?: LockerPlayabilityMode;
}): Promise<LockerEntry[]> {
  await refreshBlobStoreIdCache();
  const { entries: fresh, rowHints } = await readLockerEntriesFromDb({
    skipArtBlobPreload: !isBootUiInteractive(),
  });
  const base = options?.hard ? fresh : mergeLockerEntries(lockerCache, fresh);
  const finalized = await finalizeLockerCacheEntries(base, {
    playabilityMode: options?.playabilityMode,
    rowHints,
  });
  return setLockerCache(finalized);
}

export async function getLockerEntries(): Promise<LockerEntry[]> {
  if (lockerCache) return lockerCache;
  if (!lockerLoadPromise) {
    const bootFast = !isBootUiInteractive();
    lockerLoadPromise = readLockerEntriesFromDb({ skipArtBlobPreload: bootFast })
      .then(({ entries, rowHints }) =>
        finalizeLockerCacheEntries(entries, {
          playabilityMode: bootFast ? 'fast' : 'full',
          rowHints,
        }),
      )
      .then((entries) => {
        lockerLoadPromise = null;
        return setLockerCache(entries);
      })
      .catch((err) => {
        lockerLoadPromise = null;
        console.warn('[locker] vault load failed:', err);
        return setLockerCache([]);
      });
  }
  return lockerLoadPromise;
}

export async function saveLockerFilesAsAlbum(
  allFiles: File[],
  albumName: string,
  artist: string,
): Promise<LockerEntry[]> {
  const audioFiles = allFiles.filter(isAudioFile).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  if (audioFiles.length === 0) return [];

  const album = albumName.trim() || 'Uploaded Album';
  const art = artist.trim() || 'Local Upload';

  const imageFile = pickAlbumCoverImage(allFiles);

  const durations = await Promise.all(audioFiles.map((file) => probeAudioDuration(file)));
  const id3Tags = await Promise.all(audioFiles.map((file) => readId3FromFile(file)));

  const uploadBytes =
    audioFiles.reduce((n, f) => n + f.size, 0) + (imageFile?.size ?? 0);
  await assertLockerCapacityForUpload(uploadBytes);

  const db = await initDB();
  const saved: LockerEntry[] = [];
  let seq = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const id3 = id3Tags[i];
      const id = `locker-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 8)}`;
      const trackTitle =
        (id3.title ? normaliseTitle(id3.title) : '') ||
        parseTrackTitleFromFilename(file.name);
      const trackArtist = resolveUploadArtist(file, id3, album, art);
      const playUrl = URL.createObjectURL(file);
      const trackPos = parseId3Position(id3.track);
      const discPos = parseId3Position(id3.disc);
      const entry = {
        id,
        title: trackTitle,
        artist: trackArtist,
        albumArtist: id3.albumArtist?.trim() || undefined,
        releaseYear: id3.year?.trim() || undefined,
        genre: id3.genre?.trim() || 'Local',
        albumName: album,
        albumArtBlob: imageFile,
        bitrate: 320,
        durationSeconds: durations[i] ?? 0,
        isCustom: true,
        audioBlob: file,
        url: playUrl,
        addedAt: Date.now(),
        trackNumber: trackPos.index,
        discNumber: discPos.index,
        lyrics: id3.lyrics?.trim() || undefined,
        initialKey: id3.initialKey?.trim() || undefined,
      };
      putTrackRowWithBlobs(store, blobStore, entry);
      const coverUrl = imageFile ? URL.createObjectURL(imageFile) : undefined;
      saved.push({
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        genre: entry.genre,
        durationSeconds: durations[i] ?? 0,
        url: playUrl,
        addedAt: entry.addedAt,
        albumName: album,
        albumArt: coverUrl,
        trackNumber: trackPos.index,
        discNumber: discPos.index,
        lyrics: id3.lyrics?.trim() || undefined,
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await refreshLockerCache();

  for (const entry of saved) {
    void import('./sonicAnalysisQueue')
      .then((m) => m.enqueueSonicAnalysis(entry.id))
      .catch(() => undefined);
  }

  const uploadedIds = new Set(saved.map((e) => e.id));
  const snap = getLockerEntriesSnapshot() ?? [];
  const uploaded = snap.filter((e) => uploadedIds.has(e.id));
  if (uploaded.length > 0) {
    const uploadedIds = uploaded.map((e) => e.id);
    void import('./deviceImportMetadata')
      .then((m) => m.repairMislabeledStubArtistsInVaultSafe(uploadedIds))
      .catch(() => undefined);
  }

  for (let i = 0; i < saved.length; i++) {
    scheduleLockerRemotePush(saved[i]!, audioFiles[i]!);
  }

  return saved;
}

export interface SaveLockerBlobMeta {
  title: string;
  artist: string;
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  durationSeconds?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  /** Skip Tier34 locker push (e.g. when importing from remote). */
  skipRemoteSync?: boolean;
  /** Skip decodeAudioData replay-gain scan (mobile downloads / large blobs). */
  skipHeavyAnalysis?: boolean;
  mimeType?: string;
  /** Re-use an existing locker row id (retag/replace audio — never delete the row). */
  replaceEntryId?: string;
}

function scheduleLockerRemotePush(entry: LockerEntry, blob: Blob): void {
  void import('./lockerSync')
    .then((m) => m.maybePushLockerEntryToRemote(entry, blob))
    .catch(() => undefined);
}

export type MobileAudioSource =
  | { kind: 'file'; uri: string; mimeType?: string }
  | { kind: 'blob'; blob: Blob };

export type SaveLockerBlobFromNativeResult = {
  entry: LockerEntry;
  bytes: number;
};

/** Save locker audio from a native file URI (no JS blob copy — keeps UI responsive). */
export async function saveLockerBlobFromNativeFile(
  fileUri: string,
  meta: SaveLockerBlobMeta,
): Promise<SaveLockerBlobFromNativeResult> {
  const replaceId = meta.replaceEntryId?.trim();
  const id = replaceId || `locker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { yieldToMain } = await import('./yieldToMain');
  await yieldToMain();

  let nativeBytes = 0;
  const originalFileUri = fileUri.trim();
  let nativeSourcePath = originalFileUri;
  if (isAndroid()) {
    const { registerLockerBlobFromFileUri, probeNativeLockerContentUri } = await import(
      './nativeExoLockerBridge'
    );
    const imported = await registerLockerBlobFromFileUri(id, originalFileUri, meta.mimeType);
    if (!imported?.contentUri || !(await probeNativeLockerContentUri(id))) {
      throw new Error(
        'Offline cache failed — could not store audio for playback. Free space and try again.',
      );
    }
    nativeBytes = imported.bytes;
    // Keep the durable yt-dlp file path — never store content:// as the only source.
    nativeSourcePath = originalFileUri;
  }

  if (nativeBytes > 0) {
    await assertLockerCapacityForUpload(nativeBytes);
  }

  const durationSeconds =
    meta.durationSeconds && meta.durationSeconds > 0 ? meta.durationSeconds : 0;

  const existingRow = replaceId
    ? ((await readLockerRowById(replaceId)) as LockerRow | undefined)
    : undefined;
  const row = {
    id,
    title: meta.title.trim() || 'Untitled',
    artist: meta.artist.trim() || 'Unknown Artist',
    albumName: meta.albumName?.trim() || existingRow?.albumName || undefined,
    albumArtist: meta.albumArtist?.trim() || existingRow?.albumArtist || undefined,
    releaseYear: meta.releaseYear?.trim() || existingRow?.releaseYear || undefined,
    genre: meta.genre?.trim() || existingRow?.genre || 'Downloaded',
    bitrate: 320,
    durationSeconds,
    isCustom: true,
    hasAudioBlob: true,
    nativeAudioCached: true,
    nativeSourcePath,
    addedAt: existingRow?.addedAt ?? Date.now(),
    trackNumber: meta.trackNumber ?? existingRow?.trackNumber,
    discNumber: meta.discNumber ?? existingRow?.discNumber,
    replayGainDb: (existingRow as LockerRow & { replayGainDb?: number | null })?.replayGainDb ?? null,
    creditsJson: existingRow?.creditsJson,
    albumArt: existingRow?.albumArt,
  };

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Always copy bytes into IndexedDB while the download/source file exists.
  // ytdlp-locker paths are cache-temp (not "stable"), but skipping this left
  // offlineReady dependent only on Android locker_blobs cache — albums then
  // vanish from artist pages after cache eviction or failed native probe.
  if (originalFileUri) {
    await persistFileUriToBlobStore(id, originalFileUri).catch(() => false);
  }

  const out: LockerEntry = {
    id: row.id,
    title: formatDisplayTrackTitle(row.title),
    artist: row.artist,
    genre: row.genre,
    durationSeconds,
    url: '',
    addedAt: row.addedAt,
    albumName: row.albumName,
    albumArtist: row.albumArtist,
    releaseYear: row.releaseYear,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    offlineReady: true,
  };

  await refreshLockerCache({ hard: true });

  void import('./lockerDurability')
    .then((m) => m.recordLockerIntegrityEntry(id, { nativePath: nativeSourcePath }))
    .catch(() => undefined);

  return { entry: out, bytes: nativeBytes };
}

/** Lightweight peak scan — placeholder ReplayGain dB for future normalization. */
async function estimateReplayGainDb(blob: Blob): Promise<number | undefined> {
  if (typeof AudioContext === 'undefined') return undefined;
  // Full decode on large files OOMs mobile WebView during background downloads.
  if (blob.size > 6 * 1024 * 1024) return undefined;
  try {
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(await blob.slice(0, 6 * 1024 * 1024).arrayBuffer());
    let peak = 0;
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < data.length; i += 128) {
        const v = Math.abs(data[i] ?? 0);
        if (v > peak) peak = v;
      }
    }
    await ctx.close();
    if (peak <= 0) return undefined;
    return Math.round(20 * Math.log10(peak) * 10) / 10;
  } catch {
    return undefined;
  }
}

/** Save a fetched audio blob into the locker vault with metadata. */
export async function saveLockerBlob(
  file: File | Blob,
  meta: SaveLockerBlobMeta,
): Promise<LockerEntry> {
  const replaceId = meta.replaceEntryId?.trim();
  const id = replaceId || `locker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingRow = replaceId
    ? ((await readLockerRowById(replaceId)) as LockerRow | undefined)
    : undefined;
  if (replaceId) {
    const prior = (lockerCache ?? []).find((e) => e.id === replaceId);
    if (prior?.url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prior.url);
      } catch {
        /* ignore */
      }
    }
  }
  const durationSeconds =
    meta.durationSeconds && meta.durationSeconds > 0
      ? meta.durationSeconds
      : await probeAudioDuration(file, { allowDecode: !meta.skipHeavyAnalysis });

  await assertLockerCapacityForUpload(file.size);

  const replayGainDb =
    meta.skipHeavyAnalysis || file.size > 6 * 1024 * 1024
      ? undefined
      : await estimateReplayGainDb(file);

  let lyrics: string | undefined;
  let trackNumber = meta.trackNumber;
  let discNumber = meta.discNumber;
  if (file instanceof File) {
    const id3 = await readId3FromFile(file);
    lyrics = id3.lyrics?.trim() || undefined;
    if (trackNumber == null) trackNumber = parseId3Position(id3.track).index;
    if (discNumber == null) discNumber = parseId3Position(id3.disc).index;
  }

  if (isAndroid()) {
    const { registerLockerBlobFromBlob, probeNativeLockerContentUri } = await import(
      './nativeExoLockerBridge'
    );
    const uri = await registerLockerBlobFromBlob(id, file, file.type || undefined);
    if (!uri || !(await probeNativeLockerContentUri(id))) {
      throw new Error(
        'Offline cache failed — could not store audio for playback. Free space and try again.',
      );
    }
  }

  const entry = {
    id,
    title: meta.title.trim() || 'Untitled',
    artist: meta.artist.trim() || 'Unknown Artist',
    albumName: meta.albumName?.trim() || existingRow?.albumName || undefined,
    albumArtist: meta.albumArtist?.trim() || existingRow?.albumArtist || undefined,
    releaseYear: meta.releaseYear?.trim() || existingRow?.releaseYear || undefined,
    genre: meta.genre?.trim() || existingRow?.genre || 'Downloaded',
    bitrate: 320,
    durationSeconds,
    isCustom: true,
    audioBlob: file,
    url: URL.createObjectURL(file),
    addedAt: existingRow?.addedAt ?? Date.now(),
    trackNumber: trackNumber ?? existingRow?.trackNumber,
    discNumber: discNumber ?? existingRow?.discNumber,
    replayGainDb: replayGainDb ?? (existingRow as LockerRow & { replayGainDb?: number | null })?.replayGainDb ?? null,
    lyrics: lyrics ?? existingRow?.lyrics,
    creditsJson: existingRow?.creditsJson,
    albumArt: existingRow?.albumArt,
  };

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    putTrackRowWithBlobs(tx.objectStore(STORE_NAME), tx.objectStore(BLOB_STORE_NAME), entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const out: LockerEntry = {
    id: entry.id,
    title: formatDisplayTrackTitle(entry.title),
    artist: entry.artist,
    genre: entry.genre,
    durationSeconds,
    url: entry.url,
    addedAt: entry.addedAt,
    albumName: entry.albumName,
    albumArtist: entry.albumArtist,
    releaseYear: entry.releaseYear,
    trackNumber: entry.trackNumber,
    discNumber: entry.discNumber,
    lyrics: entry.lyrics,
  };
  await refreshLockerCache();

  void import('./sonicAnalysisQueue')
    .then((m) => m.enqueueSonicAnalysis(out.id))
    .catch(() => undefined);

  if (!meta.skipRemoteSync) {
    scheduleLockerRemotePush(out, file);
  }

  void import('./lockerDurability')
    .then((m) => m.recordLockerIntegrityEntry(id))
    .catch(() => undefined);

  return out;
}

export async function saveLockerFile(
  file: File,
  title?: string,
  artist?: string,
  albumName?: string,
): Promise<LockerEntry> {
  const id = `locker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = file.name.replace(/\.[^/.]+$/, '');
  const durationSeconds = await probeAudioDuration(file);
  const id3 = await readId3FromFile(file);

  await assertLockerCapacityForUpload(file.size);

  const replayGainDb = await estimateReplayGainDb(file);

  const resolvedTitle =
    title?.trim() ||
    (id3.title ? normaliseTitle(id3.title) : '') ||
    parseTrackTitleFromFilename(file.name) ||
    name;
  const resolvedArtist = resolveUploadArtist(file, id3, albumName, artist);
  const resolvedAlbum = albumName?.trim() || id3.album?.trim() || undefined;

  const entry = {
    id,
    title: resolvedTitle,
    artist: resolvedArtist,
    albumName: resolvedAlbum,
    albumArtist: id3.albumArtist?.trim() || undefined,
    releaseYear: id3.year?.trim() || undefined,
    genre: id3.genre?.trim() || 'Local',
    bitrate: 320,
    durationSeconds,
    isCustom: true,
    audioBlob: file,
    url: URL.createObjectURL(file),
    addedAt: Date.now(),
    replayGainDb: replayGainDb ?? null,
    lyrics: id3.lyrics?.trim() || undefined,
    initialKey: id3.initialKey?.trim() || undefined,
  };

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    putTrackRowWithBlobs(tx.objectStore(STORE_NAME), tx.objectStore(BLOB_STORE_NAME), entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const out: LockerEntry = {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    genre: entry.genre,
    durationSeconds,
    url: entry.url,
    addedAt: entry.addedAt,
    albumName: entry.albumName,
    lyrics: entry.lyrics,
  };
  await refreshLockerCache();

  void import('./sonicAnalysisQueue')
    .then((m) => m.enqueueSonicAnalysis(out.id))
    .catch(() => undefined);

  if (resolvedAlbum) {
    void import('./deviceImportMetadata')
      .then((m) => m.repairMislabeledStubArtistsInVaultSafe([out.id]))
      .catch(() => undefined);
  }

  scheduleLockerRemotePush(out, file);

  return out;
}

export async function updateLockerEntryMetadata(
  id: string,
  patch: {
    albumArt?: string;
    albumArtBlob?: Blob;
    releaseYear?: string;
    albumName?: string;
    title?: string;
    artist?: string;
    genre?: string;
    durationSeconds?: number;
    albumArtist?: string;
    composer?: string;
    trackNumber?: number;
    discNumber?: number;
    discCount?: string;
    performers?: string;
    producers?: string;
    engineers?: string;
    linerNotesUrl?: string;
    bookletUrl?: string;
    creditsJson?: string;
    trackPerformers?: string;
    trackProducers?: string;
    trackSoloists?: string;
    lyrics?: string;
    userMetadataLocked?: boolean;
  },
  options?: { skipCacheRefresh?: boolean; userEdit?: boolean },
): Promise<void> {
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const blobStore = tx.objectStore(BLOB_STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result as Record<string, unknown> | undefined;
      if (!row) {
        resolve();
        return;
      }
      if (row.userMetadataLocked === true && !options?.userEdit) {
        const onlyArt =
          Object.keys(patch).every((k) => k === 'albumArt' || k === 'albumArtBlob') &&
          ('albumArt' in patch || 'albumArtBlob' in patch);
        if (!onlyArt) {
          resolve();
          return;
        }
      }
      const preservedArtBlob = isStoredArtBlob(row.albumArtBlob)
        ? storedArtToBlob(row.albumArtBlob) ?? undefined
        : undefined;
      const preservedArt =
        typeof row.albumArt === 'string' && isPersistentAlbumArt(row.albumArt)
          ? row.albumArt.trim()
          : undefined;

      const cleanPatch = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as typeof patch;

      const next: Record<string, unknown> = { ...row, ...cleanPatch };
      if (options?.userEdit) {
        next.userMetadataLocked = true;
      } else if (patch.userMetadataLocked !== undefined) {
        next.userMetadataLocked = patch.userMetadataLocked;
      }

      const clearingArt = 'albumArt' in patch && patch.albumArt === '';
      const updatingArtUrl =
        'albumArt' in patch &&
        patch.albumArt !== undefined &&
        patch.albumArt !== '' &&
        Boolean(patch.albumArt?.trim());
      const updatingArtBlob = isStoredArtBlob(patch.albumArtBlob);

      if (updatingArtBlob) {
        next.albumArtBlob = patch.albumArtBlob;
        if (!updatingArtUrl) delete next.albumArt;
      }
      if (clearingArt) {
        delete next.albumArt;
        if (!updatingArtBlob) delete next.albumArtBlob;
      } else if (updatingArtUrl) {
        const art = patch.albumArt!.trim();
        if (isPersistentAlbumArt(art)) {
          next.albumArt = art;
          delete next.albumArtBlob;
        } else {
          delete next.albumArt;
          if (!updatingArtBlob) delete next.albumArtBlob;
        }
      } else if (!updatingArtBlob) {
        if (preservedArtBlob) next.albumArtBlob = preservedArtBlob;
        if (preservedArt) next.albumArt = preservedArt;
      }

      putTrackRowWithBlobs(store, blobStore, next);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (!options?.skipCacheRefresh) {
    await refreshLockerCache();
  }
}

function proxiedCoverArtFetchUrl(url: string): string {
  return resolveCoverFetchUrl(url);
}

/** URL to store when blob bytes could not be fetched — same-origin when proxied. */
function persistableCoverArtUrl(url: string): string {
  const proxied = proxiedCoverArtFetchUrl(url);
  return isPersistentAlbumArt(proxied) ? proxied : url.trim();
}

/** Fetch cover image bytes (proxied CAA / cover-proxy / server-side / direct HTTPS). Best-effort; never throws. */
async function fetchCoverImageBlob(artUrl: string): Promise<Blob | null> {
  const trimmed = artUrl.trim();
  if (!trimmed) return null;

  const candidates = [
    proxiedCoverArtFetchUrl(trimmed),
    !useDirectMediaUpstream() && externalCoverNeedsProxy(trimmed) ? coverProxyPath(trimmed) : '',
    trimmed,
  ].filter((u, i, arr) => u && arr.indexOf(u) === i);

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        console.warn('[locker] cover fetch HTTP', res.status, url.slice(0, 120));
        continue;
      }
      const blob = await res.blob();
      if (blob.size <= 0) continue;
      if (blob.type.startsWith('image/')) return blob;
      return new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
    } catch (err) {
      console.warn('[locker] cover fetch failed:', url.slice(0, 120), err);
    }
  }

  if (trimmed.startsWith('https://')) {
    try {
      const res = await fetchWithTimeout(
        `/api/cover-bytes?url=${encodeURIComponent(trimmed)}`,
      );
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
          return blob.type.startsWith('image/')
            ? blob
            : new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
        }
      } else {
        console.warn('[locker] cover-bytes HTTP', res.status, trimmed.slice(0, 120));
      }
    } catch (err) {
      console.warn('[locker] cover-bytes failed:', trimmed.slice(0, 120), err);
    }
  }

  return null;
}

function rowHasPersistedCover(row: LockerRow): boolean {
  return isStoredArtBlob(row.albumArtBlob) || isPersistentAlbumArt(row.albumArt);
}

/** True when the group has cover bytes in IndexedDB or a reload-safe art URL (not a session blob:). */
export async function albumGroupHasPersistedCover(
  tracks: Pick<LockerEntry, 'id' | 'albumArt'>[],
): Promise<boolean> {
  if (tracks.some((t) => isPersistentAlbumArt(t.albumArt))) return true;
  for (const t of tracks) {
    const blob = await readEntryArtBlob(t.id);
    if (blob && blob.size > 0) return true;
  }
  return false;
}

async function verifyAlbumCoverPersisted(
  albumName: string,
  artist: string,
): Promise<boolean> {
  const rows = tracksForAlbumGroupRows(await readAllLockerRows(), albumName, artist);
  return rows.some((r) => rowHasPersistedCover(r));
}

/** Apply cover patch to every track in an album group inside one IndexedDB transaction. */
async function writeAlbumCoverPatchToGroup(
  targets: LockerRow[],
  patch: { albumArtBlob?: Blob; albumArt?: string },
  extra?: { releaseYear?: string; artist?: string },
): Promise<void> {
  if (targets.length === 0) return;

  let blobBuffer: ArrayBuffer | undefined;
  let blobMime = 'image/jpeg';
  if (patch.albumArtBlob) {
    blobBuffer = await patch.albumArtBlob.arrayBuffer();
    blobMime = patch.albumArtBlob.type || 'image/jpeg';
  }

  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const target of targets) {
      const getReq = store.get(target.id);
      getReq.onsuccess = () => {
        const row = getReq.result as LockerRow | undefined;
        if (row) {
          const next: LockerRow = { ...row };
          if (blobBuffer) {
            next.albumArtBlob = new Blob([blobBuffer.slice(0)], { type: blobMime });
            delete (next as { albumArt?: string }).albumArt;
          } else if (patch.albumArt && isPersistentAlbumArt(patch.albumArt)) {
            next.albumArt = patch.albumArt.trim();
            delete (next as { albumArtBlob?: Blob }).albumArtBlob;
          }
          if (extra?.releaseYear) next.releaseYear = extra.releaseYear;
          if (extra?.artist) next.artist = extra.artist;
          store.put(next);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function tracksForAlbumGroupRows<
  T extends Pick<LockerEntry, 'albumName' | 'albumArtist' | 'artist'>,
>(rows: T[], albumName: string, artist: string): T[] {
  const targetKey = `${normalizeLockerKeyPart(albumName)}::${normalizeLockerAlbumArtistKey(artist)}`;
  return rows.filter((e) => lockerAlbumGroupKey(e) === targetKey);
}

export function tracksForAlbumGroup(
  entries: LockerEntry[],
  albumName: string,
  artist: string,
): LockerEntry[] {
  return tracksForAlbumGroupRows(entries, albumName, artist);
}

async function readAllLockerRows(): Promise<LockerRow[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as LockerRow[]);
    req.onerror = () => reject(req.error);
  });
}

/** Sum audio + cover blob sizes in IndexedDB. */
export async function getLockerStorageUsage(): Promise<LockerStorageUsage> {
  const rows = await readAllLockerRows();
  let bytes = 0;
  for (const row of rows) bytes += rowBlobBytes(row);
  return { bytes, trackCount: rows.length };
}

async function assertLockerCapacityForUpload(additionalBytes: number): Promise<void> {
  const limit = capacityLimitBytes();
  if (limit === null) return;
  const { bytes } = await getLockerStorageUsage();
  const projected = bytes + additionalBytes;
  if (projected > limit) {
    throw new LockerCapacityExceededError(limit, projected);
  }
}

/** Remove persisted cover URLs/blobs from every track in the album group. */
export async function clearAlbumCoverForGroup(
  albumName: string,
  artist: string,
): Promise<void> {
  const entries = await getLockerEntries();
  const targets = tracksForAlbumGroup(entries, albumName, artist);
  if (targets.length === 0) return;

  await Promise.all(
    targets.map((t) =>
      updateLockerEntryMetadata(t.id, { albumArt: '' }, { skipCacheRefresh: true }),
    ),
  );
  await refreshLockerCache({ hard: true });
}

/** Persist cover on every track in the album (prefers IndexedDB blob for reload safety). Returns true when DB confirms art. */
export async function persistAlbumCoverForGroup(
  albumName: string,
  artist: string,
  artUrl: string,
  extra?: { releaseYear?: string; artist?: string },
): Promise<boolean> {
  const rows = await readAllLockerRows();
  let targets = tracksForAlbumGroupRows(rows, albumName, artist);
  if (targets.length === 0) {
    const normAlbum = normalizeLockerKeyPart(albumName);
    targets = rows.filter(
      (e) => e.albumName?.trim() && normalizeLockerKeyPart(e.albumName) === normAlbum,
    );
  }
  if (targets.length === 0) {
    const entries = await getLockerEntries();
    const normAlbum = normalizeLockerKeyPart(albumName);
    targets = entries.filter(
      (e) => e.albumName?.trim() && normalizeLockerKeyPart(e.albumName) === normAlbum,
    );
  }
  if (targets.length === 0) {
    console.warn('[locker] persist cover: no tracks for group', albumName, artist);
    return false;
  }

  const groupArtist = lockerAlbumArtistConsensus(targets) || artist;

  let coverBlob = await fetchCoverImageBlob(artUrl);
  if (!coverBlob) {
    console.warn('[locker] cover blob fetch failed, storing URL fallback for', albumName);
  }

  const fallbackUrl = persistableCoverArtUrl(artUrl);
  const patch = coverBlob
    ? { albumArtBlob: coverBlob }
    : isPersistentAlbumArt(fallbackUrl)
      ? { albumArt: fallbackUrl }
      : null;

  if (!patch) {
    console.warn('[locker] no persistable cover for', albumName, artUrl.slice(0, 120));
    return false;
  }

  await writeAlbumCoverPatchToGroup(targets, patch, { ...extra, artist: extra?.artist ?? groupArtist });
  for (const t of targets) dropCachedAlbumArt(t.id);
  await refreshLockerCache();

  const verified = await verifyAlbumCoverPersisted(albumName, groupArtist);
  if (!verified) {
    console.warn('[locker] cover persist verification failed for', albumName, groupArtist);
    return false;
  }

  // Ensure every track in the group has the blob (not just URL fallback).
  if (!coverBlob) {
    return true;
  }

  const afterRows = tracksForAlbumGroupRows(await readAllLockerRows(), albumName, groupArtist);
  if (afterRows.length === 0) {
    const normAlbum = normalizeLockerKeyPart(albumName);
    const fallbackRows = (await readAllLockerRows()).filter(
      (e) => e.albumName?.trim() && normalizeLockerKeyPart(e.albumName) === normAlbum,
    );
    if (fallbackRows.some((r) => !isStoredArtBlob(r.albumArtBlob) && !r.albumArt?.trim())) {
      console.warn('[locker] cover blob missing on some tracks for', albumName);
      return false;
    }
  } else if (afterRows.some((r) => !isStoredArtBlob(r.albumArtBlob))) {
    console.warn('[locker] cover blob missing on some tracks for', albumName);
    return false;
  }

  return true;
}

/** Persist cover on a standalone orphan track (no album group). Returns true when DB confirms art. */
export async function persistOrphanTrackCover(
  entryId: string,
  artUrl: string,
  extra?: { releaseYear?: string },
): Promise<boolean> {
  const rows = await readAllLockerRows();
  const target = rows.find((r) => r.id === entryId);
  if (!target) {
    console.warn('[locker] persist orphan cover: no entry for', entryId);
    return false;
  }

  let coverBlob = await fetchCoverImageBlob(artUrl);
  if (!coverBlob) {
    console.warn('[locker] orphan cover blob fetch failed, storing URL fallback for', entryId);
  }

  const fallbackUrl = persistableCoverArtUrl(artUrl);
  const patch: Parameters<typeof updateLockerEntryMetadata>[1] = {
    ...(extra?.releaseYear ? { releaseYear: extra.releaseYear } : {}),
  };

  if (coverBlob) {
    patch.albumArtBlob = coverBlob;
  } else if (isPersistentAlbumArt(fallbackUrl)) {
    patch.albumArt = fallbackUrl;
  } else {
    console.warn('[locker] no persistable orphan cover for', entryId, artUrl.slice(0, 120));
    return false;
  }

  await updateLockerEntryMetadata(entryId, patch, { skipCacheRefresh: true });
  dropCachedAlbumArt(entryId);
  await refreshLockerCache();

  const after = (await readAllLockerRows()).find((r) => r.id === entryId);
  if (!after || !rowHasPersistedCover(after)) {
    console.warn('[locker] orphan cover persist verification failed for', entryId);
    return false;
  }

  return true;
}

/** Manual cover — save JPG/PNG on a standalone orphan track. */
export async function persistOrphanTrackCoverBlob(
  entryId: string,
  imageFile: File,
): Promise<void> {
  const rows = await readAllLockerRows();
  if (!rows.some((r) => r.id === entryId)) {
    throw new Error('No track found for this single');
  }

  const buffer = await imageFile.arrayBuffer();
  const mime = imageFile.type || 'image/jpeg';
  const coverBlob = new Blob([buffer], { type: mime });

  await updateLockerEntryMetadata(entryId, { albumArtBlob: coverBlob }, { skipCacheRefresh: true });
  dropCachedAlbumArt(entryId);
  await refreshLockerCache();
}

/** Manual cover — save JPG/PNG blob on every track in the album group. */
export async function persistAlbumCoverBlobForGroup(
  albumName: string,
  artist: string,
  imageFile: File,
): Promise<void> {
  const rows = await readAllLockerRows();
  const targets = tracksForAlbumGroupRows(rows, albumName, artist);
  if (targets.length === 0) {
    throw new Error('No tracks found for this album');
  }

  const buffer = await imageFile.arrayBuffer();
  const mime = imageFile.type || 'image/jpeg';
  const coverBlob = new Blob([buffer], { type: mime });

  await writeAlbumCoverPatchToGroup(targets, { albumArtBlob: coverBlob });
  for (const t of targets) dropCachedAlbumArt(t.id);
  await refreshLockerCache();
}

/**
 * Backfill cover art for album groups that have none, by extracting embedded
 * artwork from the audio files already stored in IndexedDB. Returns true if any
 * cover was added. Best-effort and safe to call repeatedly.
 */
/**
 * Convert URL-only album covers (proxied /coverart or external HTTPS) into
 * albumArtBlob so art survives hard reload without relying on network URLs.
 */
export async function backfillUrlAlbumCoversToBlobs(): Promise<boolean> {
  const raw = await readAllLockerRows();

  const groups = new Map<string, LockerRow[]>();
  for (const row of raw) {
    if (!row.albumName?.trim()) continue;
    if (isStoredArtBlob(row.albumArtBlob)) continue;
    if (!isPersistentAlbumArt(row.albumArt)) continue;
    const key = lockerAlbumGroupKey(row);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  let changed = false;
  for (const tracks of groups.values()) {
    const artUrl = tracks.find((t) => t.albumArt?.trim())?.albumArt?.trim();
    if (!artUrl) continue;
    const blob = await fetchCoverImageBlob(artUrl);
    if (!blob) continue;
    try {
      await persistAlbumCoverBlobForGroup(
        tracks[0].albumName!,
        tracks[0].artist ?? 'Local Upload',
        new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }),
      );
      changed = true;
    } catch {
      /* ignore */
    }
  }
  return changed;
}

/** Read TRCK/TPOS from embedded tags for locker rows missing track positions. */
export async function backfillLockerTrackNumbers(): Promise<boolean> {
  const entries = await getLockerEntries();
  let changed = false;
  for (const entry of entries) {
    if (entry.trackNumber != null && entry.trackNumber > 0) continue;
    const blob = await readEntryAudioBlob(entry.id);
    if (!blob) continue;
    try {
      const head = blob.slice(0, Math.min(blob.size, 256 * 1024));
      const tags = parseId3v2Tags(await head.arrayBuffer());
      const trackNumber = parseId3Position(tags.track).index;
      const discNumber = parseId3Position(tags.disc).index;
      if (trackNumber == null && discNumber == null) continue;
      await updateLockerEntryMetadata(
        entry.id,
        {
          ...(trackNumber != null ? { trackNumber } : {}),
          ...(discNumber != null ? { discNumber } : {}),
        },
        { skipCacheRefresh: true },
      );
      changed = true;
    } catch {
      /* ignore */
    }
  }
  if (changed) await refreshLockerCache();
  return changed;
}

export async function backfillEmbeddedAlbumCovers(): Promise<boolean> {
  const entries = await getLockerEntries();
  const groups = new Map<string, LockerEntry[]>();
  for (const e of entries) {
    const key = lockerAlbumGroupKey(e);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  let changed = false;
  for (const tracks of groups.values()) {
    if (tracks.some((t) => t.albumArt && t.albumArt.trim())) continue;
    for (const t of tracks.slice(0, 4)) {
      const blob = await readEntryAudioBlob(t.id);
      if (!blob) continue;
      const probe = new File([blob], t.title || 'track', {
        type: blob.type || 'audio/flac',
      });
      const cover = await extractEmbeddedCover(probe);
      if (!cover) continue;
      try {
        await persistAlbumCoverBlobForGroup(
          tracks[0].albumName!,
          tracks[0].artist ?? 'Local Upload',
          cover,
        );
        changed = true;
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return changed;
}

/** Unify albumArtist metadata so one release does not split into multiple locker collections. */
export async function normalizeAlbumGroupArtists(): Promise<number> {
  const rows = await readAllLockerRows();
  const byTitle = new Map<string, LockerRow[]>();
  for (const row of rows) {
    const name = row.albumName?.trim();
    if (!name) continue;
    const titleKey = normalizeLockerKeyPart(name);
    const list = byTitle.get(titleKey);
    if (list) list.push(row);
    else byTitle.set(titleKey, [row]);
  }

  let updated = 0;
  for (const tracks of byTitle.values()) {
    const consensus = lockerAlbumArtistConsensus(tracks);
    if (!consensus || /^local upload$/i.test(consensus)) continue;
    for (const row of tracks) {
      const current = row.albumArtist?.trim()
        ? albumPrimaryArtist(row.albumArtist)
        : albumPrimaryArtist(row.artist ?? '');
      if (normalizeLockerKeyPart(current) === normalizeLockerKeyPart(consensus)) continue;
      await updateLockerEntryMetadata(
        row.id,
        { albumArtist: consensus },
        { skipCacheRefresh: true },
      );
      updated += 1;
    }
  }
  if (updated > 0) await refreshLockerCache({ hard: true });
  return updated;
}

/**
 * Clear Last.fm logo/default tiles stored as albumArt (metadata only — never deletes audio).
 * Returns count of rows cleared so callers can re-fetch real covers.
 */
export async function clearLastFmBrandingAlbumArt(): Promise<number> {
  const rows = await readAllLockerRows();
  let cleared = 0;
  for (const row of rows) {
    if (!isLastFmBrandingCoverUrl(row.albumArt)) continue;
    await updateLockerEntryMetadata(
      row.id,
      { albumArt: '' },
      { skipCacheRefresh: true },
    );
    await clearEntryArtBlob(row.id);
    cleared += 1;
  }
  if (cleared > 0) await refreshLockerCache({ hard: true });
  return cleared;
}

type KnownAlbumMergeRule = {
  matchAlbum: (albumKey: string) => boolean;
  matchArtist: (artistKey: string, albumArtistKey: string, titleKey: string) => boolean;
  targetAlbumName: string;
  targetAlbumArtist: string;
};

/** One-shot / ongoing retags that keep the same release together without deleting audio. */
const KNOWN_ALBUM_MERGE_RULES: KnownAlbumMergeRule[] = [
  {
    // Flip Phone Shorty landed as its own "…Strictly For Da Streetz…" album via feat. billing.
    matchAlbum: (albumKey) =>
      albumKey.includes('flip phone') ||
      albumKey.includes('strictly for da streetz') ||
      (albumKey.includes('strictly') && albumKey.includes('streetz')),
    matchArtist: (artistKey, albumArtistKey, titleKey) => {
      const hay = `${artistKey} ${albumArtistKey} ${titleKey}`;
      return (
        hay.includes('denzel') ||
        hay.includes('asap ferg') ||
        hay.includes('a$ap ferg') ||
        hay.includes('ferg')
      );
    },
    targetAlbumName: 'Strictly 4 The Scythe',
    targetAlbumArtist: 'Denzel Curry',
  },
];

/**
 * Merge known mis-split releases into the canonical album (retag only — never deletes audio).
 */
export async function mergeKnownSplitAlbumGroups(): Promise<number> {
  const rows = await readAllLockerRows();
  let updated = 0;
  for (const row of rows) {
    const albumKey = normalizeLockerKeyPart(row.albumName ?? '');
    if (!albumKey) continue;
    const artistKey = normalizeLockerKeyPart(row.artist ?? '');
    const albumArtistKey = normalizeLockerKeyPart(row.albumArtist ?? '');
    const titleKey = normalizeLockerKeyPart(row.title ?? '');

    for (const rule of KNOWN_ALBUM_MERGE_RULES) {
      if (!rule.matchAlbum(albumKey)) continue;
      if (!rule.matchArtist(artistKey, albumArtistKey, titleKey)) continue;
      const already =
        normalizeLockerKeyPart(row.albumName ?? '') ===
          normalizeLockerKeyPart(rule.targetAlbumName) &&
        normalizeLockerKeyPart(albumPrimaryArtist(row.albumArtist ?? row.artist ?? '')) ===
          normalizeLockerKeyPart(rule.targetAlbumArtist);
      if (already) continue;
      await updateLockerEntryMetadata(
        row.id,
        {
          albumName: rule.targetAlbumName,
          albumArtist: rule.targetAlbumArtist,
          // Keep track-level feat. billing; only unify the release grouping.
        },
        { skipCacheRefresh: true },
      );
      updated += 1;
      break;
    }
  }
  if (updated > 0) await refreshLockerCache({ hard: true });
  return updated;
}

export async function updateAlbumGroupMetadata(
  albumName: string,
  artist: string,
  patch: {
    albumArt?: string;
    albumArtBlob?: Blob;
    releaseYear?: string;
    albumName?: string;
    artist?: string;
    albumArtist?: string;
    composer?: string;
    discCount?: string;
    genre?: string;
    performers?: string;
    producers?: string;
    engineers?: string;
    linerNotesUrl?: string;
    bookletUrl?: string;
    creditsJson?: string;
  },
  options?: { trackIds?: string[]; userEdit?: boolean },
): Promise<void> {
  const entries = await getLockerEntries();
  const byIds =
    options?.trackIds?.length &&
    entries.filter((e) => options.trackIds!.includes(e.id));
  const targets =
    byIds && byIds.length > 0 ? byIds : tracksForAlbumGroup(entries, albumName, artist);
  await Promise.all(
    targets.map((t) =>
      updateLockerEntryMetadata(t.id, patch, {
        skipCacheRefresh: true,
        userEdit: options?.userEdit,
      }),
    ),
  );
  await refreshLockerCache();
}

/** True when album group has no online credits persisted yet. */
export function albumGroupNeedsCredits(tracks: LockerEntry[]): boolean {
  const sample = tracks[0];
  if (!sample) return false;
  return !(
    sample.creditsJson?.trim() ||
    sample.performers?.trim() ||
    sample.producers?.trim() ||
    sample.engineers?.trim()
  );
}

export async function removeAlbumFromLocker(
  albumName: string,
  artist: string,
  options?: { userConfirmed?: symbol },
): Promise<number> {
  const { assertLockerUserDeleteConfirmed } = await import('./lockerDeleteGuard');
  assertLockerUserDeleteConfirmed(options?.userConfirmed, 'removeAlbumFromLocker');
  const entries = await getLockerEntries();
  const targets = tracksForAlbumGroup(entries, albumName, artist);
  await Promise.all(
    targets.map((t) =>
      removeLockerEntry(t.id, { skipCacheRefresh: true, userConfirmed: options?.userConfirmed }),
    ),
  );
  await refreshLockerCache();
  return targets.length;
}

export async function removeLockerEntry(
  id: string,
  options?: { skipCacheRefresh?: boolean; skipTombstone?: boolean; userConfirmed?: symbol },
): Promise<void> {
  const { assertLockerUserDeleteConfirmed } = await import('./lockerDeleteGuard');
  assertLockerUserDeleteConfirmed(options?.userConfirmed, 'removeLockerEntry');
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(BLOB_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (!options?.skipTombstone) {
    const { recordTrackTombstone } = await import('./lockerTrackTombstones');
    recordTrackTombstone(id);
  }
  const { removeLockerIntegrityEntry } = await import('./lockerDurability');
  removeLockerIntegrityEntry(id);
  if (!options?.skipCacheRefresh) {
    await refreshLockerCache();
  }
}

export async function clearLockerVault(options?: { userConfirmed?: symbol }): Promise<void> {
  const { assertLockerUserDeleteConfirmed } = await import('./lockerDeleteGuard');
  assertLockerUserDeleteConfirmed(options?.userConfirmed, 'clearLockerVault');
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(BLOB_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const { clearLockerIntegrityManifest } = await import('./lockerDurability');
  clearLockerIntegrityManifest();
  setLockerCache([]);
}
