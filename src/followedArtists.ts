/**
 * Persist followed artists locally (name, catalog id, MusicBrainz id).
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import { isAirGapEnabled } from './airGapMode';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { resolveArtistMusicBrainzId } from './searchCatalog';

const STORAGE_KEY = 'sandbox_followed_artists';
const UNFOLLOWED_STORAGE_KEY = 'sandbox_unfollowed_artists';
const MAX_FOLLOWED = 64;

export const FOLLOWED_ARTISTS_CHANGE_EVENT = 'sandbox-followed-artists-change';

export type FollowSource = 'locker' | 'manual';

export type FollowedArtist = {
  name: string;
  catalogArtistId?: string;
  musicbrainzArtistId?: string;
  followedAt: number;
  source?: FollowSource;
};

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FOLLOWED_ARTISTS_CHANGE_EVENT));
  }
}

function normalizeArtistKey(value: string): string {
  return normalizeIdentityKey(value);
}

function readAll(): FollowedArtist[] {
  try {
    const raw = prefsGetItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FollowedArtist[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a) => a && typeof a.name === 'string' && a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        catalogArtistId: a.catalogArtistId?.trim() || undefined,
        musicbrainzArtistId: a.musicbrainzArtistId?.trim() || undefined,
        followedAt: typeof a.followedAt === 'number' ? a.followedAt : Date.now(),
        source: (a.source === 'locker' ? 'locker' : 'manual') as FollowSource,
      }))
      .sort((a, b) => b.followedAt - a.followedAt);
  } catch {
    return [];
  }
}

function writeAll(artists: FollowedArtist[]): void {
  prefsSetItem(STORAGE_KEY, JSON.stringify(artists.slice(0, MAX_FOLLOWED)));
  notify();
}

function readUnfollowedKeys(): Set<string> {
  try {
    const raw = prefsGetItem(UNFOLLOWED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((k) => typeof k === 'string' && k.trim())
        .map((k) => normalizeArtistKey(k)),
    );
  } catch {
    return new Set();
  }
}

function writeUnfollowedKeys(keys: Set<string>): void {
  prefsSetItem(UNFOLLOWED_STORAGE_KEY, JSON.stringify([...keys]));
}

export function isUnfollowedArtist(nameOrId: string): boolean {
  const key = normalizeArtistKey(nameOrId);
  return readUnfollowedKeys().has(key);
}

function addUnfollowedArtist(nameOrId: string): void {
  const key = normalizeArtistKey(nameOrId);
  if (!key) return;
  const keys = readUnfollowedKeys();
  keys.add(key);
  writeUnfollowedKeys(keys);
}

function removeFromUnfollowed(nameOrId: string): void {
  const key = normalizeArtistKey(nameOrId);
  if (!key) return;
  const keys = readUnfollowedKeys();
  if (!keys.delete(key)) return;
  writeUnfollowedKeys(keys);
}

export function subscribeFollowedArtists(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFollowedArtists(): FollowedArtist[] {
  return readAll();
}

export function getFollowedArtistCount(): number {
  return readAll().length;
}

export function isFollowingArtist(nameOrId: string): boolean {
  const key = normalizeArtistKey(nameOrId);
  return readAll().some(
    (a) =>
      normalizeArtistKey(a.name) === key ||
      (a.catalogArtistId && normalizeArtistKey(a.catalogArtistId) === key),
  );
}

export function findFollowedArtist(nameOrId: string): FollowedArtist | undefined {
  const key = normalizeArtistKey(nameOrId);
  return readAll().find(
    (a) =>
      normalizeArtistKey(a.name) === key ||
      (a.catalogArtistId && normalizeArtistKey(a.catalogArtistId) === key),
  );
}

export async function followArtist(input: {
  name: string;
  catalogArtistId?: string;
  musicbrainzArtistId?: string;
  source?: FollowSource;
  skipMbLookup?: boolean;
}): Promise<FollowedArtist> {
  const name = input.name.trim();
  if (!name) throw new Error('Artist name required');

  const source: FollowSource = input.source === 'locker' ? 'locker' : 'manual';
  if (source === 'manual') {
    removeFromUnfollowed(name);
    if (input.catalogArtistId) removeFromUnfollowed(input.catalogArtistId);
  }

  const existing = findFollowedArtist(name) ?? findFollowedArtist(input.catalogArtistId ?? '');
  if (existing) {
    if (source === 'manual' && existing.source === 'locker') {
      const upgraded: FollowedArtist = {
        ...existing,
        source: 'manual',
        catalogArtistId: input.catalogArtistId?.trim() || existing.catalogArtistId,
        musicbrainzArtistId:
          input.musicbrainzArtistId?.trim() ||
          existing.musicbrainzArtistId,
      };
      const next = readAll().map((a) =>
        normalizeArtistKey(a.name) === normalizeArtistKey(name) ? upgraded : a,
      );
      writeAll(next);
      return upgraded;
    }
    return existing;
  }

  let musicbrainzArtistId = input.musicbrainzArtistId?.trim();
  if (!musicbrainzArtistId && !input.skipMbLookup && !isAirGapEnabled()) {
    musicbrainzArtistId = await resolveArtistMusicBrainzId(name);
  }

  const entry: FollowedArtist = {
    name,
    catalogArtistId: input.catalogArtistId?.trim() || undefined,
    musicbrainzArtistId,
    followedAt: Date.now(),
    source,
  };

  const next = [
    entry,
    ...readAll().filter((a) => normalizeArtistKey(a.name) !== normalizeArtistKey(name)),
  ];
  writeAll(next);
  return entry;
}

export function unfollowArtist(nameOrId: string): void {
  const key = normalizeArtistKey(nameOrId);
  const match = readAll().find(
    (a) =>
      normalizeArtistKey(a.name) === key ||
      (a.catalogArtistId && normalizeArtistKey(a.catalogArtistId) === key),
  );
  if (match) addUnfollowedArtist(match.name);
  addUnfollowedArtist(nameOrId);

  const next = readAll().filter(
    (a) =>
      normalizeArtistKey(a.name) !== key &&
      !(a.catalogArtistId && normalizeArtistKey(a.catalogArtistId) === key),
  );
  writeAll(next);
}

export function updateFollowedArtistMbId(name: string, musicbrainzArtistId: string): void {
  const key = normalizeArtistKey(name);
  const mbId = musicbrainzArtistId.trim();
  if (!mbId) return;
  const next = readAll().map((a) =>
    normalizeArtistKey(a.name) === key ? { ...a, musicbrainzArtistId: mbId } : a,
  );
  writeAll(next);
}
