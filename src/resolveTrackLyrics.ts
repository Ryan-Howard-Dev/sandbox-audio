/**
 * Passive lyrics resolution for the main shell — reuses locker metadata,
 * embedded ID3 USLT, and GET /api/lyrics (LRCLIB proxy).
 */

import { fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';
import {
  fetchLyricsFromLrcLibDirect,
  preferDirectLyrics,
} from './lrcLibDirect';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  CACHE_KEYS,
  cacheKeyPart,
  prefixedCacheKey,
  LYRICS_CACHE_TTL_MS,
  readResponseCache,
  writeResponseCache,
} from './responseCache';
import {
  findLockerEntryForTrack,
  getLockerEntriesSnapshot,
  readEmbeddedLyricsFromLocker,
  resolveLyricsSearchArtist,
  type LockerEntry,
} from './lockerStorage';

export type LyricsSource = 'locker' | 'embedded' | 'api' | 'none';

export type LyricsStatus = 'ready' | 'empty' | 'offline' | 'blocked' | 'error';

/** Structure for future time-synced lyrics; plain text only today. */
export interface SyncedLyricLine {
  timeMs?: number;
  text: string;
}

export interface ResolvedLyrics {
  text: string | null;
  source: LyricsSource;
  synced: boolean;
  lines: SyncedLyricLine[];
  loading: boolean;
  status: LyricsStatus;
  /** User-facing hint when lyrics are unavailable (not loading). */
  hint: string | null;
}

export const EMPTY_LYRICS: ResolvedLyrics = {
  text: null,
  source: 'none',
  synced: false,
  lines: [],
  loading: false,
  status: 'empty',
  hint: null,
};

const PLACEHOLDER_LYRICS =
  /^(no lyrics|no real-time synchronized lyrics|\[lyrics offline|lookup service offline|no lyrics offline|no lyrics available under public license)/i;

export function isDisplayableLyrics(text: string | null | undefined): text is string {
  const t = text?.trim();
  if (!t) return false;
  return !PLACEHOLDER_LYRICS.test(t);
}

const LRC_LINE =
  /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;

function parseLrcTimestamp(minStr: string, secStr: string, fracStr?: string): number {
  const min = parseInt(minStr, 10);
  const sec = parseInt(secStr, 10);
  const ms = fracStr ? parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) : 0;
  return min * 60_000 + sec * 1_000 + ms;
}

function toResolved(text: string, source: LyricsSource, syncedLyrics?: string | null): ResolvedLyrics {
  const syncedRaw = syncedLyrics?.trim();
  if (syncedRaw) {
    const lines: SyncedLyricLine[] = [];
    const plainLines: string[] = [];
    for (const raw of syncedRaw.split(/\r?\n/)) {
      const match = raw.match(LRC_LINE);
      if (match) {
        const timeMs = parseLrcTimestamp(match[1], match[2], match[3]);
        const lineText = match[4].trim();
        if (lineText) {
          lines.push({ timeMs, text: lineText });
          plainLines.push(lineText);
        }
      }
    }
    if (lines.length > 0) {
      return {
        text: plainLines.join('\n'),
        source,
        synced: true,
        lines,
        loading: false,
        status: 'ready',
        hint: null,
      };
    }
  }

  const lines = text.split(/\r?\n/).map((line) => ({ text: line }));
  return {
    text,
    source,
    synced: false,
    lines,
    loading: false,
    status: 'ready',
    hint: null,
  };
}

function emptyWithHint(status: LyricsStatus, hint: string): ResolvedLyrics {
  return { ...EMPTY_LYRICS, status, hint };
}

type LyricsApiResponse = {
  found?: boolean;
  lyrics?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  offline?: boolean;
  airGap?: boolean;
};

/** GET /api/lyrics on web dev, or LRCLIB directly on native / when proxy is unavailable. */
export async function fetchLyricsFromApi(
  artist: string,
  title: string,
  album = '',
  durationSeconds = 0,
): Promise<{ lyrics: string | null; syncedLyrics: string | null; status: LyricsStatus }> {
  const a = (artist ?? '').trim();
  const t = (title ?? '').trim();
  if (!t && !a) {
    return { lyrics: null, syncedLyrics: null, status: 'empty' };
  }

  const cacheKey = prefixedCacheKey(
    CACHE_KEYS.LYRICS,
    `${cacheKeyPart(a)}|${cacheKeyPart(t)}|${Math.round(durationSeconds)}`,
  );
  const cached = readResponseCache<{
    lyrics: string | null;
    syncedLyrics: string | null;
    status: LyricsStatus;
  }>(cacheKey, { staleMaxMs: LYRICS_CACHE_TTL_MS * 7 });
  if (cached?.isFresh) return cached.data;

  const applyDirect = async (): Promise<{
    lyrics: string | null;
    syncedLyrics: string | null;
    status: LyricsStatus;
  } | null> => {
    const direct = await fetchLyricsFromLrcLibDirect(t, a, album, durationSeconds);
    if (!direct) return null;
    const synced = direct.syncedLyrics || null;
    const plain = direct.plainLyrics || null;
    const lyrics = synced || plain;
    if (!isDisplayableLyrics(lyrics)) return null;
    return { lyrics, syncedLyrics: synced, status: 'ready' as const };
  };

  const cacheDirectOrNull = async (): Promise<{
    lyrics: string | null;
    syncedLyrics: string | null;
    status: LyricsStatus;
  } | null> => {
    const directResult = await applyDirect();
    if (!directResult) return null;
    writeResponseCache(cacheKey, directResult, LYRICS_CACHE_TTL_MS);
    return directResult;
  };

  const cacheEmpty = (): {
    lyrics: string | null;
    syncedLyrics: string | null;
    status: LyricsStatus;
  } => {
    const empty = { lyrics: null, syncedLyrics: null, status: 'empty' as const };
    writeResponseCache(cacheKey, empty, LYRICS_CACHE_TTL_MS);
    return empty;
  };

  if (preferDirectLyrics()) {
    const directResult = await cacheDirectOrNull();
    if (directResult) return directResult;
    return cached?.data ?? { lyrics: null, syncedLyrics: null, status: 'offline' as const };
  }

  const params = new URLSearchParams();
  if (t) params.set('title', t);
  if (a) params.set('artist', a);
  if (album.trim()) params.set('album', album.trim());
  if (durationSeconds > 0) params.set('duration', String(Math.round(durationSeconds)));

  const url = `/api/lyrics?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 451) {
      return { lyrics: null, syncedLyrics: null, status: 'blocked' };
    }
    if (!res.ok) {
      const directResult = await cacheDirectOrNull();
      if (directResult) return directResult;
      return {
        lyrics: null,
        syncedLyrics: null,
        status: res.status >= 500 ? 'offline' : 'empty',
      };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!isJsonLikeContentType(contentType)) {
      const directResult = await cacheDirectOrNull();
      if (directResult) return directResult;
      return cacheEmpty();
    }
    const data = (await res.json()) as LyricsApiResponse;
    if (data.airGap) {
      return { lyrics: null, syncedLyrics: null, status: 'blocked' };
    }
    if (data.offline) {
      const directResult = await cacheDirectOrNull();
      if (directResult) return directResult;
      return { lyrics: null, syncedLyrics: null, status: 'offline' };
    }
    const synced = data.syncedLyrics?.trim() ?? '';
    const plain = data.plainLyrics?.trim() ?? data.lyrics?.trim() ?? '';
    const lyrics = synced || plain;
    if (!isDisplayableLyrics(lyrics)) {
      const directResult = await cacheDirectOrNull();
      if (directResult) return directResult;
      return cacheEmpty();
    }
    const result = {
      lyrics,
      syncedLyrics: synced || null,
      status: 'ready' as const,
    };
    writeResponseCache(cacheKey, result, LYRICS_CACHE_TTL_MS);
    return result;
  } catch {
    const directResult = await cacheDirectOrNull();
    if (directResult) return directResult;
    return cached?.data ?? { lyrics: null, syncedLyrics: null, status: 'offline' as const };
  }
}

export type ResolveLyricsInput = {
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  envelope?: MediaEnvelope | null;
};

/**
 * Priority: locker metadata → embedded USLT → GET /api/lyrics (LRCLIB).
 * Never throws; returns null text when unavailable.
 */
export async function resolveTrackLyrics(
  input: ResolveLyricsInput,
): Promise<ResolvedLyrics> {
  const title = (input.title ?? '').trim();
  const artist = (input.artist ?? '').trim();
  const envelope = input.envelope;
  const album = (input.album ?? envelope?.album ?? '').trim();
  const durationSeconds =
    input.durationSeconds ?? envelope?.durationSeconds ?? 0;

  if (!title && !artist) {
    return emptyWithHint('empty', 'Play a track to see lyrics.');
  }

  const sourceId = envelope?.sourceId;
  const entries = getLockerEntriesSnapshot();
  let lockerAlbum = album;
  let lockerEntry: LockerEntry | null = null;

  if (sourceId && envelope?.provider === 'local-vault') {
    lockerEntry = entries?.find((e) => e.id === sourceId) ?? null;
  } else if (entries?.length) {
    lockerEntry = findLockerEntryForTrack(title, artist, album, entries);
  }

  if (lockerEntry?.lyrics && isDisplayableLyrics(lockerEntry.lyrics)) {
    return toResolved(lockerEntry.lyrics.trim(), 'locker');
  }
  if (lockerEntry?.albumName?.trim()) lockerAlbum = lockerEntry.albumName.trim();

  const embeddedSourceId =
    sourceId && envelope?.provider === 'local-vault' ? sourceId : lockerEntry?.id;
  if (embeddedSourceId) {
    const embedded = await readEmbeddedLyricsFromLocker(embeddedSourceId);
    if (isDisplayableLyrics(embedded)) {
      return toResolved(embedded!.trim(), 'embedded');
    }
  }

  const search = resolveLyricsSearchArtist(title, artist, lockerAlbum, lockerEntry);
  const api = await fetchLyricsFromApi(
    search.artist,
    search.title,
    search.album,
    durationSeconds,
  );
  if (api.status === 'ready' && isDisplayableLyrics(api.lyrics)) {
    return toResolved(api.lyrics!.trim(), 'api', api.syncedLyrics);
  }

  if (api.status === 'blocked') {
    return emptyWithHint(
      'blocked',
      'Lyrics lookup is off while Air-Gap Mode is enabled.',
    );
  }
  if (api.status === 'offline') {
    return emptyWithHint(
      'offline',
      'Could not reach the lyrics service. Check your connection and try again.',
    );
  }

  return emptyWithHint(
    'empty',
    `No lyrics found for "${title || 'this track'}".`,
  );
}
