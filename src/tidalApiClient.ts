import { fetchWithTimeout } from './fetchWithTimeout';

/** Public read-only client used by open-source TIDAL tooling (e.g. python-tidal). */
const TIDAL_CLIENT_ID = 'REDACTED_TIDAL_CLIENT_ID';
const TIDAL_CLIENT_SECRET = 'REDACTED_TIDAL_CLIENT_SECRET';

const TIDAL_TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_BASE = 'https://api.tidal.com/v1';

const TIDAL_COUNTRY_FALLBACKS = ['GB', 'US', 'DE', 'FR', 'NO', 'NL', 'AU', 'CA'] as const;

const TOKEN_TIMEOUT_MS = 8_000;
const API_TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_TRACKS = 500;
const PAGE_LIMIT = 100;

export interface TidalApiTrackStub {
  title: string;
  artist?: string;
  duration?: number;
}

interface TidalTokenCache {
  accessToken: string;
  expiresAtMs: number;
}

interface TidalItemsPage {
  limit?: number;
  offset?: number;
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
}

let tokenCache: TidalTokenCache | null = null;

const FULL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTidalFullPlaylistUuid(id: string): boolean {
  return FULL_UUID_RE.test(id);
}

export function extractTidalPlaylistUuidFromEmbedHtml(html: string): string | null {
  const match = html.match(
    /tidal\.com\/playlist\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match?.[1] ?? null;
}

export function extractTidalCountryCodeFromEmbedHtml(html: string): string | undefined {
  const match = html.match(/tidalCountryCode=['"]([^'"]+)['"]/i);
  const code = match?.[1]?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function parseTidalApiItem(
  entry: NonNullable<TidalItemsPage['items']>[number],
): TidalApiTrackStub | null {
  const track = entry.item;
  const title = track?.title?.trim();
  if (!title) return null;
  const artist =
    track?.artists?.[0]?.name?.trim() ||
    track?.artist?.name?.trim() ||
    undefined;
  return {
    title,
    artist,
    duration: track?.duration ?? undefined,
  };
}

async function fetchTidalAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.accessToken;
  }

  const credentials = btoa(`${TIDAL_CLIENT_ID}:${TIDAL_CLIENT_SECRET}`);
  try {
    const res = await fetchWithTimeout(
      TIDAL_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
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

function buildCountryOrder(preferred?: string): string[] {
  const order: string[] = [];
  if (preferred) order.push(preferred.toUpperCase());
  for (const code of TIDAL_COUNTRY_FALLBACKS) {
    if (!order.includes(code)) order.push(code);
  }
  return order;
}

export async function fetchAllTidalPlaylistItems(
  playlistUuid: string,
  options?: { preferredCountryCode?: string; maxTracks?: number },
): Promise<{ tracks: TidalApiTrackStub[]; total?: number; countryCode?: string }> {
  const accessToken = await fetchTidalAccessToken();
  if (!accessToken) return { tracks: [] };

  const maxTracks = options?.maxTracks ?? MAX_PLAYLIST_TRACKS;
  const countries = buildCountryOrder(options?.preferredCountryCode);

  for (const countryCode of countries) {
    const tracks: TidalApiTrackStub[] = [];
    let offset = 0;
    let total: number | undefined;

    while (tracks.length < maxTracks) {
      const url = `${TIDAL_API_BASE}/playlists/${encodeURIComponent(playlistUuid)}/items?countryCode=${countryCode}&limit=${PAGE_LIMIT}&offset=${offset}`;
      let page: TidalItemsPage;
      try {
        const res = await fetchWithTimeout(
          url,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          API_TIMEOUT_MS,
        );
        if (!res.ok) break;
        page = (await res.json()) as TidalItemsPage;
      } catch {
        break;
      }

      if (page.status === 404 || page.userMessage) break;

      total = page.totalNumberOfItems ?? total;
      const batch = (page.items ?? [])
        .map(parseTidalApiItem)
        .filter((t): t is TidalApiTrackStub => Boolean(t));
      if (!batch.length) break;

      tracks.push(...batch);
      offset += batch.length;

      if (total !== undefined && offset >= total) break;
      if (batch.length < PAGE_LIMIT) break;
    }

    if (tracks.length > 0) {
      return { tracks, total: total ?? tracks.length, countryCode };
    }
  }

  return { tracks: [] };
}

/** Reset cached token (tests). */
export function resetTidalApiClientForTests(): void {
  tokenCache = null;
}
