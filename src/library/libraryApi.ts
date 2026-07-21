/**
 * Tier34 library proxy client — Subsonic (Navidrome) + Jellyfin.
 */

import { fetchWithTimeout } from '../fetchWithTimeout';
import { getTier34BaseUrl } from '../tier34/client';
import type { LibraryServerConfig } from './libraryServerSettings';

function tier34Url(path: string): string {
  return `${getTier34BaseUrl().replace(/\/$/, '')}${path}`;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 20_000): Promise<T> {
  const res = await fetchWithTimeout(
    tier34Url(path),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new Error((data as { error?: string }).error ?? `Library API HTTP ${res.status}`);
  }
  return data;
}

function serverBody(server: LibraryServerConfig): Record<string, unknown> {
  return {
    baseUrl: server.baseUrl,
    username: server.username,
    password: server.password,
    accessToken: server.accessToken,
    userId: server.userId,
  };
}

export async function pingLibraryServer(
  server: LibraryServerConfig,
): Promise<{ accessToken?: string; userId?: string }> {
  const data = await postJson<{
    ok: boolean;
    accessToken?: string;
    userId?: string;
  }>('/api/library/ping', { ...serverBody(server), kind: server.type === 'jellyfin' ? 'jellyfin' : 'subsonic' });
  return { accessToken: data.accessToken, userId: data.userId };
}

export async function subsonicApi<T>(
  server: LibraryServerConfig,
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const data = await postJson<{ ok: boolean; data: T }>('/api/library/subsonic', {
    ...serverBody(server),
    endpoint,
    params,
  });
  return data.data;
}

export async function jellyfinApi<T>(
  server: LibraryServerConfig,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const data = await postJson<{ ok: boolean; data: T }>('/api/library/jellyfin', {
    ...serverBody(server),
    path,
    params,
  });
  return data.data;
}

export async function resolveLibraryStreamUrl(
  server: LibraryServerConfig,
  songId: string,
): Promise<string> {
  const data = await postJson<{ ok: boolean; url: string }>('/api/library/stream-url', {
    ...serverBody(server),
    kind: server.type === 'jellyfin' ? 'jellyfin' : 'subsonic',
    songId,
  });
  const rel = data.url.startsWith('/') ? data.url : `/${data.url}`;
  return tier34Url(rel);
}
