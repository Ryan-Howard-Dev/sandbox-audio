import crypto from 'node:crypto';

type OAuthProvider = 'spotify' | 'apple' | 'youtube' | 'soundcloud';

interface OAuthSession {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const sessions = new Map<string, OAuthSession>();
const pendingPkce = new Map<string, { verifier: string; provider: OAuthProvider }>();

function base64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  return { verifier, challenge };
}

export function getOAuthAuthorizeUrl(
  provider: OAuthProvider,
  redirectUri: string,
): { url: string; state: string } {
  const { verifier, challenge } = createPkce();
  const state = base64Url(crypto.randomBytes(16));
  pendingPkce.set(state, { verifier, provider });

  if (provider === 'spotify' && process.env.SPOTIFY_CLIENT_ID) {
    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'playlist-read-private playlist-read-collaborative user-library-read',
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    return {
      url: `https://accounts.spotify.com/authorize?${params}`,
      state,
    };
  }

  // Functional demo OAuth — completes without external app registration
  const demoUrl = `${redirectUri}?state=${state}&code=demo_${provider}_${Date.now()}`;
  return { url: demoUrl, state };
}

export async function completeOAuthCallback(
  provider: OAuthProvider,
  code: string,
  state: string,
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const pending = pendingPkce.get(state);
  pendingPkce.delete(state);

  if (code.startsWith('demo_')) {
    const token = `demo-token-${provider}-${stableToken()}`;
    sessions.set(token, {
      provider,
      accessToken: token,
      expiresAt: Date.now() + 3600_000,
    });
    return { ok: true, token };
  }

  if (provider === 'spotify' && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && pending) {
    const redirectUri =
      process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:3001/api/oauth/spotify/callback';
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      code_verifier: pending.verifier,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return { ok: false, error: 'Spotify token exchange failed' };
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    const token = data.access_token;
    sessions.set(token, {
      provider: 'spotify',
      accessToken: token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    return { ok: true, token };
  }

  return { ok: false, error: 'OAuth not configured — set SPOTIFY_CLIENT_ID or use demo flow' };
}

function stableToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function getSession(token: string): OAuthSession | undefined {
  const s = sessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return s;
}

export async function fetchProviderPlaylists(
  token: string,
): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    tracks: Array<{ title: string; artist: string; album: string; duration: number }>;
  }>
> {
  const session = getSession(token);
  if (!session) return [];

  if (session.provider === 'spotify' && !token.startsWith('demo-token')) {
    const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id: string; name: string; description?: string }>;
    };
    const out = [];
    for (const pl of data.items ?? []) {
      const trRes = await fetch(
        `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=30`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      );
      const trData = trRes.ok
        ? ((await trRes.json()) as {
            items?: Array<{
              track?: {
                name?: string;
                duration_ms?: number;
                album?: { name?: string };
                artists?: Array<{ name?: string }>;
              };
            }>;
          })
        : { items: [] };
      out.push({
        id: pl.id,
        name: pl.name,
        description: pl.description ?? '',
        tracks: (trData.items ?? [])
          .map((i) => i.track)
          .filter(Boolean)
          .map((t) => ({
            title: t!.name ?? 'Track',
            artist: t!.artists?.map((a) => a.name).join(' & ') ?? 'Unknown',
            album: t!.album?.name ?? '',
            duration: Math.round((t!.duration_ms ?? 0) / 1000),
          })),
      });
    }
    return out;
  }

  return [
    {
      id: 'demo-1',
      name: 'Tier 4 Bridge — Essentials',
      description: 'OAuth bridge active (demo or live token).',
      tracks: [
        { title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', album: 'Discovery', duration: 224 },
        { title: 'Get Lucky', artist: 'Daft Punk', album: 'RAM', duration: 248 },
      ],
    },
  ];
}
