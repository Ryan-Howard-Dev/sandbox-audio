/**
 * Jellyfin / Navidrome server library — settings persisted locally.
 */

import { prefsGetItem, prefsSetItem } from '../prefsStorage';

export type LibraryServerType = 'navidrome' | 'jellyfin';

export type LibraryServerConfig = {
  id: string;
  name: string;
  type: LibraryServerType;
  baseUrl: string;
  username: string;
  password: string;
  accessToken?: string;
  userId?: string;
};

const SERVERS_KEY = 'sandbox_library_servers_v1';
export const LIBRARY_SERVERS_CHANGE_EVENT = 'sandbox-library-servers-change';

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LIBRARY_SERVERS_CHANGE_EVENT));
  }
}

function newServerId(): string {
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadLibraryServers(): LibraryServerConfig[] {
  try {
    const raw = prefsGetItem(SERVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LibraryServerConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s?.id && s.baseUrl && s.username);
  } catch {
    return [];
  }
}

export function saveLibraryServers(servers: LibraryServerConfig[]): void {
  prefsSetItem(SERVERS_KEY, JSON.stringify(servers));
  notify();
}

export function upsertLibraryServer(
  input: Omit<LibraryServerConfig, 'id'> & { id?: string },
): LibraryServerConfig {
  const servers = loadLibraryServers();
  const next: LibraryServerConfig = {
    id: input.id?.trim() || newServerId(),
    name: input.name.trim() || input.baseUrl.trim(),
    type: input.type,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    username: input.username.trim(),
    password: input.password,
    accessToken: input.accessToken,
    userId: input.userId,
  };
  const idx = servers.findIndex((s) => s.id === next.id);
  if (idx >= 0) servers[idx] = next;
  else servers.push(next);
  saveLibraryServers(servers);
  return next;
}

export function removeLibraryServer(id: string): void {
  saveLibraryServers(loadLibraryServers().filter((s) => s.id !== id));
}

export function subscribeLibraryServers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
