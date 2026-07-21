/**
 * Android native SQLite mirror for locker metadata — fast search at 10k+ tracks.
 * IndexedDB remains source of truth; mirror is rebuilt on vault warm/refresh.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { LockerEntry } from './lockerStorage';

export type LockerMirrorTrack = {
  id: string;
  title: string;
  artist: string;
  albumName?: string;
  genre?: string;
  addedAt: number;
};

export type LockerMirrorSearchHit = {
  id: string;
  title: string;
  artist: string;
  albumName?: string;
};

export interface LockerMirrorPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  upsertTracks(options: { tracks: LockerMirrorTrack[] }): Promise<{ count: number }>;
  search(options: { query: string; limit?: number }): Promise<{ hits: LockerMirrorSearchHit[] }>;
  getCount(): Promise<{ count: number }>;
  listAllTracks(options?: { limit?: number }): Promise<{ hits: LockerMirrorSearchHit[] }>;
  clear(): Promise<void>;
}

const LockerMirrorNative = registerPlugin<LockerMirrorPlugin>('LockerMirror', {
  web: () =>
    import('./lockerMirror.web').then((m) => new m.LockerMirrorWeb()),
});

export function lockerMirrorAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function syncLockerMirror(entries: LockerEntry[]): Promise<number> {
  if (!lockerMirrorAvailable()) return 0;
  try {
    const { available } = await LockerMirrorNative.isAvailable();
    if (!available) return 0;
    const tracks: LockerMirrorTrack[] = entries.map((e) => ({
      id: e.id,
      title: e.title,
      artist: e.artist,
      albumName: e.albumName,
      genre: e.genre,
      addedAt: e.addedAt,
    }));
    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < tracks.length; i += CHUNK) {
      const slice = tracks.slice(i, i + CHUNK);
      const res = await LockerMirrorNative.upsertTracks({ tracks: slice });
      total += res.count ?? slice.length;
    }
    return total;
  } catch (err) {
    console.warn('[lockerMirror] sync failed', err);
    return 0;
  }
}

export async function searchLockerMirror(
  query: string,
  limit = 50,
): Promise<LockerMirrorSearchHit[]> {
  if (!lockerMirrorAvailable() || query.trim().length < 2) return [];
  try {
    const res = await LockerMirrorNative.search({ query: query.trim(), limit });
    return res.hits ?? [];
  } catch {
    return [];
  }
}

export async function lockerMirrorTrackCount(): Promise<number> {
  if (!lockerMirrorAvailable()) return 0;
  try {
    const res = await LockerMirrorNative.getCount();
    return res.count ?? 0;
  } catch {
    return 0;
  }
}

export async function listLockerMirrorTracks(limit = 500): Promise<LockerMirrorSearchHit[]> {
  if (!lockerMirrorAvailable()) return [];
  try {
    const res = await LockerMirrorNative.listAllTracks({ limit });
    return res.hits ?? [];
  } catch {
    return [];
  }
}
