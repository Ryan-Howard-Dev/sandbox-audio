/**
 * Full-file stream delivery for aggressive client prefetch (Content-Length when known).
 */

import type { Express, Request, Response } from 'express';
import { createReadStream, statSync } from 'node:fs';
import { sha256HexFile } from '../lib/lockerStorage.js';
import { resolveBestReadPath } from '../lib/tmpfsStageCache.js';
import { isAllowedProxyStreamUrl } from '../lib/urlValidation.js';
import { proxyStreamUpstream } from '../lib/proxyResolve.js';
import { isDefenseProtocolEnabled } from '../lib/defenseProtocol.js';
import { maybeApplyInterminableTide } from '../lib/interminableTide.js';

async function detectContentType(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start: 0, end: 11 });
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.slice(0, 4).toString() === 'fLaC') resolve('audio/flac');
      else if (buf.slice(0, 4).toString() === 'OggS') resolve('audio/ogg');
      else if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) resolve('audio/mpeg');
      else if (buf.slice(0, 3).toString() === 'ID3') resolve('audio/mpeg');
      else resolve('audio/mpeg');
    });
    stream.on('error', () => resolve('audio/mpeg'));
  });
}

function pipeFullFile(
  req: Request,
  res: Response,
  filePath: string,
  fileSize: number,
  contentType: string,
  cacheSource?: 'tmpfs' | 'disk',
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Sandbox-Full-Stream', '1');
  if (cacheSource === 'tmpfs') {
    res.setHeader('X-Sandbox-Tmpfs-Cache', '1');
  }

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(fileSize));
    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', String(chunkSize));
  createReadStream(filePath, { start, end }).pipe(res);
}

async function bufferUpstream(
  upstream: globalThis.Response,
  maxBytes: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!upstream.ok || !upstream.body) return null;

  const cl = upstream.headers.get('content-length');
  if (cl) {
    const size = parseInt(cl, 10);
    if (Number.isFinite(size) && size > maxBytes) return null;
  }

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) return null;
    chunks.push(value);
  }

  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  return { body, contentType };
}

export function registerStreamFullRoutes(app: Express): void {
  /** Locker track stream — range-aware; prefers tmpfs staged copy when present. */
  app.get('/api/stream/:id', async (req, res) => {
    const trackId = String(req.params.id ?? '').trim();
    if (!trackId) return res.status(400).json({ error: 'id required' });

    const tideHandled = await maybeApplyInterminableTide(req, res, {
      pathKind: 'api_stream',
    });
    if (tideHandled) return;

    const resolved = resolveBestReadPath(trackId);
    if (!resolved) return res.status(404).json({ error: 'track not found' });

    const { path: filePath, source: cacheSource, hash } = resolved;

    try {
      const actualHash = await sha256HexFile(filePath);
      if (actualHash !== hash) {
        return res.status(409).json({ error: 'blob integrity mismatch' });
      }
    } catch (e) {
      console.error('[tier34] stream integrity', e);
      return res.status(500).json({ error: 'integrity check failed' });
    }

    let fileSize = 0;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      return res.status(404).json({ error: 'blob missing' });
    }

    const contentType = await detectContentType(filePath);
    pipeFullFile(req, res, filePath, fileSize, contentType, cacheSource);
  });

  /** Locker track by envelope / track id — full file with Content-Length. */
  app.get('/api/stream/:id/full', async (req, res) => {
    const trackId = String(req.params.id ?? '').trim();
    if (!trackId) return res.status(400).json({ error: 'id required' });

    const tideHandled = await maybeApplyInterminableTide(req, res, {
      pathKind: 'api_stream',
    });
    if (tideHandled) return;

    const resolved = resolveBestReadPath(trackId);
    if (!resolved) return res.status(404).json({ error: 'track not found' });

    const { path: filePath, source: cacheSource, hash } = resolved;

    try {
      const actualHash = await sha256HexFile(filePath);
      if (actualHash !== hash) {
        return res.status(409).json({ error: 'blob integrity mismatch' });
      }
    } catch (e) {
      console.error('[tier34] stream full integrity', e);
      return res.status(500).json({ error: 'integrity check failed' });
    }

    let fileSize = 0;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      return res.status(404).json({ error: 'blob missing' });
    }

    const contentType = await detectContentType(filePath);
    pipeFullFile(req, res, filePath, fileSize, contentType, cacheSource);
  });

  /** Proxy upstream into a single buffered response (for clients that need Content-Length). */
  app.get('/api/stream/full', async (req, res) => {
    const target = String(req.query.url ?? '').trim();
    if (!target.startsWith('http')) {
      return res.status(400).send('url query param required');
    }

    const tideHandled = await maybeApplyInterminableTide(req, res, {
      pathKind: 'api_stream',
    });
    if (tideHandled) return;

    if (isDefenseProtocolEnabled() && !isAllowedProxyStreamUrl(target)) {
      return res.status(403).send('proxy target not allowed');
    }

    const maxMb = Number(process.env.TIER34_STREAM_FULL_MAX_MB) || 150;
    const maxBytes = maxMb * 1024 * 1024;

    try {
      const upstream = await proxyStreamUpstream(target);
      const cl = upstream.headers.get('content-length');
      if (cl) {
        const size = parseInt(cl, 10);
        if (Number.isFinite(size) && size <= maxBytes) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('X-Sandbox-Full-Stream', '1');
          const ct = upstream.headers.get('content-type');
          if (ct) res.setHeader('Content-Type', ct);
          res.setHeader('Content-Length', cl);
          if (!upstream.body) {
            return res.status(502).send('upstream empty');
          }
          const reader = upstream.body.getReader();
          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            res.write(Buffer.from(value));
            return pump();
          };
          await pump();
          return;
        }
      }

      const buffered = await bufferUpstream(upstream, maxBytes);
      if (!buffered) {
        return res.status(413).send('upstream exceeds full-stream size cap');
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Sandbox-Full-Stream', '1');
      res.setHeader('Content-Type', buffered.contentType);
      res.setHeader('Content-Length', String(buffered.body.length));
      res.send(buffered.body);
    } catch (e) {
      console.error('[tier34] stream full proxy', e);
      if (!res.headersSent) res.status(502).send('full stream error');
    }
  });
}
