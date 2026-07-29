/**
 * TIDAL playlist import — credentials stay on the server.
 *
 * The client used to hold the id and secret and talk to TIDAL directly, which meant the pair was
 * compiled into every build and readable by anyone holding an APK. A shared credential is a
 * credential that gets rate-limited or revoked for everybody at once.
 *
 * Here the app asks its own server for a playlist and the server does the talking. The credential
 * lives in this process's environment, on hardware the operator controls, and never reaches a
 * client. It is not obscured — it is somewhere else entirely, which is the only version of this
 * that actually holds.
 *
 * Unconfigured is a normal state: no credentials means the endpoint reports that plainly and
 * playlist import is simply unavailable, rather than failing in a way that looks broken.
 */

import type { Express } from 'express';

const TIDAL_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_BASE = 'https://api.tidal.com/v1';

const TOKEN_TIMEOUT_MS = 8_000;
const API_TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_TRACKS = 500;
const PAGE_LIMIT = 100;

/** Tried in order when the caller gives no country, since playlists are region-gated. */
const COUNTRY_FALLBACKS = ['GB', 'US', 'DE', 'FR', 'NO', 'NL', 'AU', 'CA'] as const;

const FULL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TrackStub = { title: string; artist?: string; duration?: number };

type ItemsPage = {
  totalNumberOfItems?: number;
  items?: Array<{
    item?: {
      title?: string;
      duration?: number;
      artist?: { name?: string };
      artists?: Array<{ name?: string }>;
    };
  }>;
  status?: number;
  userMessage?: string;
};

let tokenCache: { accessToken: string; expiresAtMs: number } | null = null;

function clientId(): string {
  return (process.env.TIDAL_CLIENT_ID ?? '').trim();
}

function clientSecret(): string {
  return (process.env.TIDAL_CLIENT_SECRET ?? '').trim();
}

export function tidalConfigured(): boolean {
  return clientId().length > 0 && clientSecret().length > 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function accessToken(): Promise<string | null> {
  const now = Date.now();
  // Reused until a minute before expiry: a token request per playlist page would be both slow and
  // a good way to get rate-limited.
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) return tokenCache.accessToken;
  if (!tidalConfigured()) return null;

  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  try {
    const res = await fetchWithTimeout(
      TIDAL_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      TOKEN_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

function parseItem(entry: NonNullable<ItemsPage['items']>[number]): TrackStub | null {
  const track = entry.item;
  const title = track?.title?.trim();
  if (!title) return null;
  return {
    title,
    artist: track?.artists?.[0]?.name?.trim() || track?.artist?.name?.trim() || undefined,
    duration: track?.duration ?? undefined,
  };
}

function countryOrder(preferred?: string): string[] {
  const order: string[] = [];
  if (preferred) order.push(preferred.toUpperCase());
  for (const code of COUNTRY_FALLBACKS) if (!order.includes(code)) order.push(code);
  return order;
}

async function fetchPlaylist(
  uuid: string,
  preferredCountry?: string,
): Promise<{ tracks: TrackStub[]; total?: number; countryCode?: string }> {
  const token = await accessToken();
  if (!token) return { tracks: [] };

  for (const countryCode of countryOrder(preferredCountry)) {
    const tracks: TrackStub[] = [];
    let offset = 0;
    let total: number | undefined;

    while (tracks.length < MAX_PLAYLIST_TRACKS) {
      const url =
        `${TIDAL_API_BASE}/playlists/${encodeURIComponent(uuid)}/items` +
        `?countryCode=${countryCode}&limit=${PAGE_LIMIT}&offset=${offset}`;
      let page: ItemsPage;
      try {
        const res = await fetchWithTimeout(
          url,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
          API_TIMEOUT_MS,
        );
        if (!res.ok) break;
        page = (await res.json()) as ItemsPage;
      } catch {
        break;
      }

      if (page.status === 404 || page.userMessage) break;
      total = page.totalNumberOfItems ?? total;
      const batch = (page.items ?? []).map(parseItem).filter((t): t is TrackStub => Boolean(t));
      if (!batch.length) break;

      tracks.push(...batch);
      offset += batch.length;
      if (total !== undefined && offset >= total) break;
      if (batch.length < PAGE_LIMIT) break;
    }

    // A region that returns nothing is a licensing miss, not an error — try the next one.
    if (tracks.length > 0) return { tracks, total: total ?? tracks.length, countryCode };
  }
  return { tracks: [] };
}

export function registerTidalRoutes(app: Express): void {
  /** Lets the client decide whether to offer playlist import at all. */
  app.get('/api/tidal/status', (_req, res) => {
    res.json({ configured: tidalConfigured() });
  });

  app.get('/api/tidal/playlist/:uuid', async (req, res) => {
    const uuid = String(req.params.uuid ?? '').trim();
    if (!FULL_UUID_RE.test(uuid)) {
      res.status(400).json({ error: 'invalid playlist uuid' });
      return;
    }
    if (!tidalConfigured()) {
      // 501, not 500: nothing failed. The operator has not set TIDAL_CLIENT_ID and
      // TIDAL_CLIENT_SECRET, and the client should say so rather than report an outage.
      res.status(501).json({
        error: 'tidal not configured',
        detail: 'Set TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET in the tier34 environment.',
      });
      return;
    }

    const country = String(req.query.countryCode ?? '').trim() || undefined;
    try {
      const result = await fetchPlaylist(uuid, country);
      res.json(result);
    } catch {
      res.status(502).json({ error: 'tidal request failed' });
    }
  });
}
