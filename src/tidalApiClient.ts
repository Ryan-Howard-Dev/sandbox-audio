import { fetchWithTimeout } from './fetchWithTimeout';
import { getTier34BaseUrl, isServerReachableCached } from './tier34/client';

/*
 * Credentials come from the build, never from this file.
 *
 * A client id and secret were committed here and shipped inside every APK. Anyone can unzip an
 * Android package and read them, so the pair was public the moment it was distributed — and being
 * shared meant every install hit TIDAL as the same client. One person's abuse rate-limits or bans
 * the account for everyone, and the account belongs to whoever published the build.
 *
 * Supplying them at build time does not make a client-side secret secret; nothing can, because the
 * bundle ships to the user. What it does change is that the value is no longer in the repository,
 * no longer shared between unrelated installs, and absent by default — a build with none simply
 * has no TIDAL playlist import rather than silently borrowing someone else's identity. The real
 * fix is OAuth with PKCE, where the client holds no secret at all, or a server-side token broker.
 */
// Read on use, not at import: a value captured at module load cannot be overridden by a test or
// by anything that configures the app after startup.
function tidalClientId(): string {
  return (import.meta.env?.VITE_TIDAL_CLIENT_ID ?? '').trim();
}

function tidalClientSecret(): string {
  return (import.meta.env?.VITE_TIDAL_CLIENT_SECRET ?? '').trim();
}

/** True when this build was given credentials to use. */
export function tidalApiConfigured(): boolean {
  return tidalClientId().length > 0 && tidalClientSecret().length > 0;
}

let warnedUnconfigured = false;

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

  if (!tidalApiConfigured()) {
    // Said once, not per call: the feature is absent by configuration, which is a normal state for
    // a build nobody supplied credentials to, not an error worth repeating on every import.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        '[tidalApiClient] no TIDAL credentials in this build — playlist import unavailable. ' +
          'Set VITE_TIDAL_CLIENT_ID and VITE_TIDAL_CLIENT_SECRET to enable it.',
      );
    }
    return null;
  }

  const credentials = btoa(`${tidalClientId()}:${tidalClientSecret()}`);
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

/**
 * Ask the Sandbox Server for the playlist, so the credential never has to be here.
 *
 * A client-side secret cannot be kept — the bundle ships to the user. Handing the request to a
 * server the operator runs moves the credential onto their hardware, where it is genuinely
 * private, and leaves nothing in the app to extract.
 *
 * Returns null when the server is unreachable or has no credentials configured, so the caller can
 * fall through rather than treating "not set up" as a failure.
 */
async function fetchPlaylistViaTier34(
  playlistUuid: string,
  preferredCountryCode?: string,
): Promise<{ tracks: TidalApiTrackStub[]; total?: number; countryCode?: string } | null> {
  const base = getTier34BaseUrl().trim();
  if (!base || !isServerReachableCached()) return null;

  const query = preferredCountryCode
    ? `?countryCode=${encodeURIComponent(preferredCountryCode)}`
    : '';
  try {
    const res = await fetchWithTimeout(
      `${base.replace(/\/$/, '')}/api/tidal/playlist/${encodeURIComponent(playlistUuid)}${query}`,
      { headers: { Accept: 'application/json' } },
      API_TIMEOUT_MS,
    );
    // 501 means the operator has not configured credentials there. That is a normal state and the
    // caller should try its own, not report the server as broken.
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tracks?: TidalApiTrackStub[];
      total?: number;
      countryCode?: string;
    };
    if (!Array.isArray(data.tracks)) return null;
    return { tracks: data.tracks, total: data.total, countryCode: data.countryCode };
  } catch {
    return null;
  }
}

export async function fetchAllTidalPlaylistItems(
  playlistUuid: string,
  options?: { preferredCountryCode?: string; maxTracks?: number },
): Promise<{ tracks: TidalApiTrackStub[]; total?: number; countryCode?: string }> {
  /*
   * Server first, always. When tier34 holds the credential this path needs none, which is the
   * whole point — the build ships with nothing worth extracting. The direct call below remains
   * only for someone who deliberately set build-time credentials and runs no server.
   */
  const viaServer = await fetchPlaylistViaTier34(playlistUuid, options?.preferredCountryCode);
  if (viaServer && viaServer.tracks.length > 0) return viaServer;

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
