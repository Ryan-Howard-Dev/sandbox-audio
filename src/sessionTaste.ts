/**
 * Session taste vector — short-horizon listening context from recent play events.
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import { getLockerEntriesSnapshot } from './lockerStorage';
import type { LockerEntry } from './lockerStorage';
import { meaningfulListenScore } from './listeningAnalytics';
import {
  getActiveListeningSessionId,
  getAllPlayEvents,
  type PlayEvent,
} from './playHistory';
import { artistAffinityKey } from './tasteProfile';

export const SESSION_VECTOR_MAX_EVENTS = 5;
const SKIP_SESSION_WEIGHT = 0.15;
const MIN_MEANINGFUL_COMPLETION_PCT = 15;

export type SessionVector = {
  sessionId: string;
  artists: Record<string, number>;
  genres: Record<string, number>;
  /** 0–1 completion-based energy proxy for the active session. */
  avgEnergy: number;
  trackIds: string[];
  updatedAt: number;
};

function resolveGenreFromLocker(event: PlayEvent, entries: LockerEntry[]): string {
  const artist = normalizeIdentityKey(event.artist ?? '');
  const title = normalizeIdentityKey(event.title ?? '');
  const entry = entries.find(
    (e) =>
      normalizeIdentityKey(e.title) === title &&
      [e.artist, e.albumArtist ?? ''].some((a) => normalizeIdentityKey(a) === artist),
  );
  return entry?.genre?.trim() ?? '';
}

function eventSessionWeight(event: PlayEvent): number {
  if (!event.skipped) return meaningfulListenScore(event);
  if (event.completedPct < MIN_MEANINGFUL_COMPLETION_PCT) return 0;
  return SKIP_SESSION_WEIGHT * (event.completedPct / 100);
}

function isMeaningfulEvent(event: PlayEvent): boolean {
  if (!event.envelopeId?.trim()) return false;
  if (!event.skipped) return true;
  return event.completedPct >= MIN_MEANINGFUL_COMPLETION_PCT;
}

export function buildSessionVectorFromEvents(
  events: PlayEvent[],
  sessionId: string,
): SessionVector | null {
  const meaningful = events.filter(isMeaningfulEvent);
  const slice = meaningful.slice(0, SESSION_VECTOR_MAX_EVENTS);
  if (slice.length === 0) return null;

  const entries = getLockerEntriesSnapshot() ?? [];
  const artists: Record<string, number> = {};
  const genres: Record<string, number> = {};
  let energySum = 0;
  let energyWeight = 0;
  const trackIds: string[] = [];

  for (const event of slice) {
    const weight = eventSessionWeight(event);
    if (weight <= 0) continue;

    const aKey = artistAffinityKey(event.artist);
    artists[aKey] = (artists[aKey] ?? 0) + weight;

    const genre = resolveGenreFromLocker(event, entries);
    if (genre) {
      const gKey = normalizeIdentityKey(genre);
      genres[gKey] = (genres[gKey] ?? 0) + weight;
    }

    const energy = event.skipped
      ? (event.completedPct / 100) * 0.35
      : event.completedPct / 100;
    energySum += energy * weight;
    energyWeight += weight;

    const id = event.envelopeId.trim();
    if (!trackIds.includes(id)) trackIds.push(id);
  }

  if (energyWeight <= 0) return null;

  return {
    sessionId,
    artists,
    genres,
    avgEnergy: energySum / energyWeight,
    trackIds,
    updatedAt: Date.now(),
  };
}

export function getSessionVector(): SessionVector | null {
  const sessionId = getActiveListeningSessionId();
  if (!sessionId) return null;

  const sessionEvents = getAllPlayEvents().filter((e) => e.sessionId === sessionId);
  return buildSessionVectorFromEvents(sessionEvents, sessionId);
}
