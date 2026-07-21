/**
 * Jellyfin / Navidrome library proxy routes (LAN CORS bypass).
 */

import type { Express, Request, Response } from 'express';
import {
  jellyfinAuthenticate,
  jellyfinRequest,
  proxyJellyfinStream,
  proxySubsonicStream,
  subsonicRequest,
} from '../lib/libraryProxy.js';
import { mintLibraryStreamToken, verifyLibraryStreamToken } from '../lib/libraryStreamToken.js';
import { isAllowedLibraryBaseUrl, normalizeLibraryBaseUrl } from '../lib/libraryUrlValidation.js';

function readCreds(body: Record<string, unknown>): {
  baseUrl: string;
  username: string;
  password: string;
  accessToken?: string;
  userId?: string;
} {
  const baseUrl = String(body.baseUrl ?? '').trim();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!baseUrl || !username || !password) {
    throw new Error('baseUrl, username, and password required');
  }
  if (!isAllowedLibraryBaseUrl(baseUrl)) {
    throw new Error('Library base URL not allowed');
  }
  return {
    baseUrl: normalizeLibraryBaseUrl(baseUrl),
    username,
    password,
    accessToken: typeof body.accessToken === 'string' ? body.accessToken : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
  };
}

export function registerLibraryRoutes(app: Express): void {
  app.post('/api/library/subsonic', async (req, res) => {
    try {
      const creds = readCreds(req.body ?? {});
      const endpoint = String(req.body?.endpoint ?? 'ping').replace(/\.view$/i, '');
      const params =
        req.body?.params && typeof req.body.params === 'object'
          ? (req.body.params as Record<string, string | number | undefined>)
          : {};
      const data = await subsonicRequest(creds, endpoint, params);
      res.json({ ok: true, data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: msg });
    }
  });

  app.post('/api/library/jellyfin/auth', async (req, res) => {
    try {
      const creds = readCreds(req.body ?? {});
      const auth = await jellyfinAuthenticate(creds);
      res.json({ ok: true, ...auth });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: msg });
    }
  });

  app.post('/api/library/jellyfin', async (req, res) => {
    try {
      const creds = readCreds(req.body ?? {});
      const path = String(req.body?.path ?? '').trim();
      if (!path) return res.status(400).json({ ok: false, error: 'path required' });
      const params =
        req.body?.params && typeof req.body.params === 'object'
          ? (req.body.params as Record<string, string | number | undefined>)
          : {};
      const data = await jellyfinRequest(creds, path, params);
      res.json({ ok: true, data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: msg });
    }
  });

  app.post('/api/library/stream-url', (req, res) => {
    try {
      const creds = readCreds(req.body ?? {});
      const kind = req.body?.kind === 'jellyfin' ? 'jellyfin' : 'subsonic';
      const songId = String(req.body?.songId ?? '').trim();
      if (!songId) return res.status(400).json({ ok: false, error: 'songId required' });

      const token = mintLibraryStreamToken({
        kind,
        baseUrl: creds.baseUrl,
        username: creds.username,
        password: creds.password,
        songId,
        accessToken: creds.accessToken,
      });
      res.json({
        ok: true,
        url: `/api/library/stream?t=${encodeURIComponent(token)}`,
        expiresInSeconds: 3600,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.get('/api/library/stream', async (req, res) => {
    const token = String(req.query.t ?? '');
    const payload = verifyLibraryStreamToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'invalid or expired stream token' });
    }

    try {
      const upstream =
        payload.kind === 'jellyfin'
          ? await proxyJellyfinStream(
              {
                baseUrl: payload.baseUrl,
                username: payload.username,
                password: payload.password,
                accessToken: payload.accessToken,
              },
              payload.songId,
            )
          : await proxySubsonicStream(
              {
                baseUrl: payload.baseUrl,
                username: payload.username,
                password: payload.password,
              },
              payload.songId,
            );

      if (!upstream.ok || !upstream.body) {
        return res.status(upstream.status || 502).json({ error: 'upstream stream failed' });
      }

      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
        res.end();
      };
      void pump().catch(() => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
    } catch (e) {
      console.error('[tier34] library stream', e);
      if (!res.headersSent) res.status(502).json({ error: 'stream proxy failed' });
    }
  });

  app.post('/api/library/ping', async (req, res) => {
    try {
      const creds = readCreds(req.body ?? {});
      const kind = req.body?.kind === 'jellyfin' ? 'jellyfin' : 'subsonic';
      if (kind === 'jellyfin') {
        const auth = await jellyfinAuthenticate(creds);
        res.json({ ok: true, kind, ...auth });
        return;
      }
      await subsonicRequest(creds, 'ping');
      res.json({ ok: true, kind });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ ok: false, error: msg });
    }
  });
}
