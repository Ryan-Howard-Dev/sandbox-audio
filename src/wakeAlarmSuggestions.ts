/**
 * Wake alarm track suggestions — recent plays, charts, catalog search.
 */

import { isAirGapEnabled } from './airGapMode';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { getMostPlayed, getRecentlyPlayed, type StoredPlayHit } from './playHistory';
import {
  fetchChartCatalogTracks,
  fetchRemoteCatalogSearch,
  type CatalogTrack,
} from './searchCatalog';
import type { WakeAlarmTrack } from './sleepTimer';

export const WAKE_SUGGESTION_CHIPS = [
  'Upbeat',
  'Classic alarm',
  'wake up songs',
  'morning energy',
  'good morning',
  'upbeat hits',
] as const;

/** True when the wake track is an iTunes catalog preview, not a locker file. */
export function isWakeTrackCatalogPreview(track: WakeAlarmTrack): boolean {
  if (track.provider === 'local-vault') return false;
  return track.envelopeId.startsWith('catalog-') || track.provider === 'https';
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hitToWakeTrack(hit: StoredPlayHit): WakeAlarmTrack {
  return {
    envelopeId: hit.envelopeId,
    title: hit.title,
    artist: hit.artist,
    url: hit.url,
    artworkUrl: hit.artworkUrl,
    provider: hit.provider,
    sourceId: hit.sourceId,
    durationSeconds: hit.durationSeconds,
    transport: hit.transport,
    album: hit.album,
  };
}

function lockerEntryToWakeTrack(entry: {
  id: string;
  title: string;
  artist: string;
  url: string;
  albumArt?: string;
  durationSeconds: number;
  albumName?: string;
}): WakeAlarmTrack {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    url: entry.url,
    artworkUrl: entry.albumArt,
    provider: 'local-vault',
    sourceId: entry.id,
    durationSeconds: entry.durationSeconds,
    transport: 'element-src',
    album: entry.albumName,
  };
}

function findLockerMatch(track: CatalogTrack) {
  const locker = getLockerEntriesSnapshot();
  if (!locker?.length) return null;
  const nt = normalize(track.title);
  const na = normalize(track.artist);
  return locker.find((e) => normalize(e.title) === nt && normalize(e.artist) === na) ?? null;
}

export function catalogTrackToWakeTrack(track: CatalogTrack): WakeAlarmTrack | null {
  const locker = findLockerMatch(track);
  if (locker) return lockerEntryToWakeTrack(locker);

  const env = track.envelope;
  if (!env?.url || !env.envelopeId) return null;

  return {
    envelopeId: env.envelopeId,
    title: env.title ?? track.title,
    artist: env.artist ?? track.artist,
    url: env.url,
    artworkUrl: env.artworkUrl ?? track.artworkUrl,
    provider: env.provider,
    sourceId: env.sourceId,
    durationSeconds: env.durationSeconds ?? track.durationSeconds,
    transport: env.transport ?? 'element-src',
    album: env.album ?? track.album,
  };
}

export async function loadWakeAlarmSuggestions(): Promise<WakeAlarmTrack[]> {
  const seen = new Set<string>();
  const out: WakeAlarmTrack[] = [];

  const push = (track: WakeAlarmTrack | null) => {
    if (!track?.envelopeId || !track.url || seen.has(track.envelopeId)) return;
    seen.add(track.envelopeId);
    out.push(track);
  };

  getRecentlyPlayed(16).forEach((hit) => push(hitToWakeTrack(hit)));
  getMostPlayed(8).forEach((hit) => push(hitToWakeTrack(hit)));

  const locker = getLockerEntriesSnapshot();
  if (locker) {
    for (const entry of locker.slice(0, 8)) {
      push(lockerEntryToWakeTrack(entry));
      if (out.length >= 20) break;
    }
  }

  if (!isAirGapEnabled()) {
    try {
      const [charts, wakeCatalog] = await Promise.all([
        fetchChartCatalogTracks(10),
        fetchRemoteCatalogSearch('wake up songs'),
      ]);
      for (const track of charts) push(catalogTrackToWakeTrack(track));
      for (const track of wakeCatalog.tracks.slice(0, 8)) {
        push(catalogTrackToWakeTrack(track));
      }
    } catch {
      // Offline or catalog failure — locker + recent still shown
    }
  }

  return out.slice(0, 20);
}

export async function searchWakeTracksOnline(query: string): Promise<WakeAlarmTrack[]> {
  if (isAirGapEnabled()) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  try {
    const result = await fetchRemoteCatalogSearch(q);
    return result.tracks
      .map(catalogTrackToWakeTrack)
      .filter((track): track is WakeAlarmTrack => track !== null && Boolean(track.url))
      .slice(0, 30);
  } catch {
    return [];
  }
}
