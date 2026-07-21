/**
 * Temporary taste suppressions — snooze track/artist/genre (local-only).
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import type { MediaEnvelope } from './sandboxLayer1';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type SuppressionReason = 'snooze' | 'less';

export type TasteSuppression = {
  key: string;
  kind: 'track' | 'artist' | 'genre';
  until: number;
  reason: SuppressionReason;
};

export const TASTE_SUPPRESSIONS_CHANGE = 'sandbox-taste-suppressions-change';

const KEY = 'sandbox_taste_suppressions_v1';
const DEFAULT_SNOOZE_DAYS = 30;

function readAll(): TasteSuppression[] {
  try {
    const raw = prefsGetItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TasteSuppression[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((s) => s?.key && s.until > now);
  } catch {
    return [];
  }
}

function writeAll(items: TasteSuppression[]): void {
  const now = Date.now();
  const active = items.filter((s) => s.until > now);
  prefsSetItem(KEY, JSON.stringify(active));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TASTE_SUPPRESSIONS_CHANGE));
  }
}

function upsert(entry: TasteSuppression): void {
  const rest = readAll().filter((s) => !(s.kind === entry.kind && s.key === entry.key));
  writeAll([...rest, entry]);
}

function daysFromNow(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export function snoozeTrack(envelopeId: string, days = DEFAULT_SNOOZE_DAYS): void {
  const id = envelopeId.trim();
  if (!id) return;
  upsert({ key: id, kind: 'track', until: daysFromNow(days), reason: 'snooze' });
}

export function lessLikeTrack(envelopeId: string, days = DEFAULT_SNOOZE_DAYS): void {
  const id = envelopeId.trim();
  if (!id) return;
  upsert({ key: id, kind: 'track', until: daysFromNow(days), reason: 'less' });
}

export function lessLikeArtist(artist: string, days = DEFAULT_SNOOZE_DAYS): void {
  const key = normalizeIdentityKey(artist.trim());
  if (!key) return;
  upsert({ key, kind: 'artist', until: daysFromNow(days), reason: 'less' });
}

export function lessLikeGenre(genre: string, days = DEFAULT_SNOOZE_DAYS): void {
  const key = normalizeIdentityKey(genre.trim());
  if (!key) return;
  upsert({ key, kind: 'genre', until: daysFromNow(days), reason: 'less' });
}

export function isTrackSnoozed(envelopeId: string): boolean {
  const id = envelopeId.trim();
  return readAll().some((s) => s.kind === 'track' && s.key === id);
}

export function isEnvelopeSuppressed(envelope: MediaEnvelope): boolean {
  const id = envelope.envelopeId?.trim();
  if (id && isTrackSnoozed(id)) return true;
  const artistKey = normalizeIdentityKey(envelope.artist ?? '');
  if (artistKey && readAll().some((s) => s.kind === 'artist' && s.key === artistKey)) {
    return true;
  }
  return false;
}

export function loadActiveSuppressions(): TasteSuppression[] {
  return readAll();
}
