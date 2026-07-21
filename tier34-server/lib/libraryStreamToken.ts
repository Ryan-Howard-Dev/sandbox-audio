/**
 * Short-lived HMAC tokens for library stream URLs (no credentials in query strings).
 */

import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 3_600_000;

function secret(): string {
  return process.env.LIBRARY_STREAM_SECRET?.trim() || 'sandbox-library-stream-dev';
}

export type LibraryStreamPayload = {
  kind: 'subsonic' | 'jellyfin';
  baseUrl: string;
  username: string;
  password: string;
  songId: string;
  accessToken?: string;
  exp: number;
};

export function mintLibraryStreamToken(
  payload: Omit<LibraryStreamPayload, 'exp'>,
  ttlMs = DEFAULT_TTL_MS,
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlMs }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyLibraryStreamToken(token: string): LibraryStreamPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LibraryStreamPayload;
    if (!payload?.kind || !payload.baseUrl || !payload.songId) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
