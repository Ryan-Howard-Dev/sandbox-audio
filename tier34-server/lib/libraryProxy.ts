/**
 * Forward Subsonic (Navidrome) and Jellyfin API calls from the tier34 host (CORS + LAN).
 */

import { isAllowedLibraryBaseUrl, normalizeLibraryBaseUrl } from './libraryUrlValidation.js';

const SUBSONIC_VERSION = '1.16.1';
const SUBSONIC_CLIENT = 'SandboxMusic';
const JELLYFIN_CLIENT = 'Sandbox Music';
const JELLYFIN_VERSION = '1.0.0';

export type SubsonicCredentials = {
  baseUrl: string;
  username: string;
  password: string;
};

export type JellyfinCredentials = {
  baseUrl: string;
  username: string;
  password: string;
  accessToken?: string;
  userId?: string;
};

function assertLibraryUrl(baseUrl: string): string {
  const normalized = normalizeLibraryBaseUrl(baseUrl);
  if (!isAllowedLibraryBaseUrl(normalized)) {
    throw new Error('Library base URL not allowed');
  }
  return normalized;
}

export async function subsonicRequest(
  creds: SubsonicCredentials,
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const baseUrl = assertLibraryUrl(creds.baseUrl);
  const search = new URLSearchParams({
    u: creds.username,
    p: creds.password,
    v: SUBSONIC_VERSION,
    c: SUBSONIC_CLIENT,
    f: 'json',
  });
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const path = endpoint.replace(/\.view$/i, '');
  const url = `${baseUrl}/rest/${path}.view?${search.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Subsonic HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    'subsonic-response'?: { status?: string; error?: { message?: string } };
  };
  const body = data['subsonic-response'];
  if (!body || body.status === 'failed') {
    throw new Error(body?.error?.message ?? 'Subsonic request failed');
  }
  return body;
}

export async function jellyfinAuthenticate(
  creds: JellyfinCredentials,
): Promise<{ accessToken: string; userId: string }> {
  const baseUrl = assertLibraryUrl(creds.baseUrl);
  const res = await fetch(`${baseUrl}/Users/authenticatebyname`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': `MediaBrowser Client="${JELLYFIN_CLIENT}", Device="Tier34", DeviceId="sandbox-tier34", Version="${JELLYFIN_VERSION}"`,
    },
    body: JSON.stringify({
      Username: creds.username,
      Pw: creds.password,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Jellyfin auth HTTP ${res.status}`);
  }
  const data = (await res.json()) as { AccessToken?: string; User?: { Id?: string } };
  const accessToken = data.AccessToken?.trim();
  const userId = data.User?.Id?.trim();
  if (!accessToken || !userId) {
    throw new Error('Jellyfin auth missing token');
  }
  return { accessToken, userId };
}

export async function jellyfinRequest(
  creds: JellyfinCredentials,
  apiPath: string,
  searchParams: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const baseUrl = assertLibraryUrl(creds.baseUrl);
  let accessToken = creds.accessToken?.trim();
  let userId = creds.userId?.trim();
  if (!accessToken || !userId) {
    const auth = await jellyfinAuthenticate(creds);
    accessToken = auth.accessToken;
    userId = auth.userId;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = `${baseUrl}${path}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': accessToken,
      'X-Emby-Authorization': `MediaBrowser Client="${JELLYFIN_CLIENT}", Device="Tier34", DeviceId="sandbox-tier34", Version="${JELLYFIN_VERSION}", Token="${accessToken}"`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Jellyfin HTTP ${res.status}`);
  }
  return res.json();
}

export async function proxySubsonicStream(
  creds: SubsonicCredentials,
  songId: string,
): Promise<Response> {
  const baseUrl = assertLibraryUrl(creds.baseUrl);
  const search = new URLSearchParams({
    u: creds.username,
    p: creds.password,
    v: SUBSONIC_VERSION,
    c: SUBSONIC_CLIENT,
    id: songId,
  });
  const url = `${baseUrl}/rest/stream.view?${search.toString()}`;
  return fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
    signal: AbortSignal.timeout(120_000),
  });
}

export async function proxyJellyfinStream(
  creds: JellyfinCredentials,
  itemId: string,
): Promise<Response> {
  const baseUrl = assertLibraryUrl(creds.baseUrl);
  let accessToken = creds.accessToken?.trim();
  if (!accessToken) {
    accessToken = (await jellyfinAuthenticate(creds)).accessToken;
  }
  const url = `${baseUrl}/Audio/${encodeURIComponent(itemId)}/stream?static=true&api_key=${encodeURIComponent(accessToken)}`;
  return fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
    signal: AbortSignal.timeout(120_000),
  });
}
