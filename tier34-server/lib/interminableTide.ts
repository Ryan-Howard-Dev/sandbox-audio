/**
 * Interminable Tide — anti-scraper stream trap for unauthorized harvesters.
 * Activates when defense protocol is ON and the request is flagged.
 * Never intercepts authenticated Subsonic clients or legitimate Sandbox app traffic.
 */

import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { verifySubsonicAuth } from './subsonicAuth.js';
import {
  getInterminableTideMode,
  isDefenseProtocolEnabled,
  isDefenseStrictMode,
  type InterminableTideMode,
} from './defenseProtocol.js';

const CORS_ORIGIN = process.env.TIER34_CORS_ORIGIN ?? 'http://localhost:3002';
const RATE_WINDOW_MS = 60_000;
const RATE_THRESHOLD = Number(process.env.TIER34_TIDE_RATE_THRESHOLD) || 40;
const CHUNK_BYTES = Number(process.env.TIER34_TIDE_CHUNK_BYTES) || 65_536;

const BAD_UA_PATTERNS: RegExp[] = [
  /ffmpeg/i,
  /wget\//i,
  /\bcurl\b/i,
  /yt-dlp/i,
  /youtube-dl/i,
  /streamrip/i,
  /aria2/i,
  /httpie/i,
];

type TideContext = {
  pathKind: 'subsonic_stream' | 'api_stream' | 'proxy_stream';
  subsonicQuery?: Record<string, unknown>;
  filePath?: string;
  /** Admin debug — cap duration (ms). */
  maxDurationMs?: number;
};

type RateBucket = { count: number; windowStart: number };
const rateByIp = new Map<string, RateBucket>();

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function recordStreamHit(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = rateByIp.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_THRESHOLD;
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function sandboxClientId(req: Request): string {
  const header = headerValue(req, 'x-sandbox-client');
  if (header) return header;
  const q = req.query.sb_client;
  return typeof q === 'string' ? q.trim() : '';
}

function sandboxToken(req: Request): string {
  const header = headerValue(req, 'x-sandbox-token');
  if (header) return header;
  const q = req.query.token;
  return typeof q === 'string' ? q.trim() : '';
}

function matchesAllowedOrigin(req: Request): boolean {
  const origin = headerValue(req, 'origin');
  const referer = headerValue(req, 'referer');
  if (origin && origin === CORS_ORIGIN) return true;
  if (referer && referer.startsWith(CORS_ORIGIN)) return true;
  return false;
}

/** Legitimate clients bypass tide entirely. */
export function isLegitimateStreamClient(
  req: Request,
  subsonicQuery?: Record<string, unknown>,
): boolean {
  if (subsonicQuery && verifySubsonicAuth(subsonicQuery)) return true;

  const clientId = sandboxClientId(req);
  if (clientId.startsWith('sandbox-music/')) return true;

  const token = sandboxToken(req);
  if (token.length >= 12) return true;

  if (matchesAllowedOrigin(req)) return true;

  return false;
}

export function isFlaggedScraper(
  req: Request,
  ctx: Pick<TideContext, 'pathKind' | 'subsonicQuery'>,
): { flagged: boolean; reasons: string[] } {
  if (isLegitimateStreamClient(req, ctx.subsonicQuery)) {
    return { flagged: false, reasons: [] };
  }

  const reasons: string[] = [];
  const ua = headerValue(req, 'user-agent');

  if (ctx.pathKind === 'subsonic_stream' && ctx.subsonicQuery) {
    if (!verifySubsonicAuth(ctx.subsonicQuery)) {
      reasons.push('missing_subsonic_auth');
    }
  }

  for (const pat of BAD_UA_PATTERNS) {
    if (pat.test(ua)) {
      const isCurl = /\bcurl\b/i.test(ua);
      if (isCurl && sandboxClientId(req).startsWith('sandbox-music/')) continue;
      reasons.push(`bad_user_agent:${ua.slice(0, 48)}`);
      break;
    }
  }

  if (isDefenseStrictMode()) {
    if (!sandboxClientId(req).startsWith('sandbox-music/')) {
      reasons.push('strict_missing_sandbox_client');
    }
  }

  if (recordStreamHit(req)) {
    reasons.push('stream_rate_threshold');
  }

  return { flagged: reasons.length > 0, reasons };
}

function isLocalAdmin(req: Request): boolean {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function resolveTideMode(req: Request): InterminableTideMode {
  if (req.query.tide === 'test' && isLocalAdmin(req)) {
    return getInterminableTideMode() === 'off' ? 'chaff' : getInterminableTideMode();
  }
  return getInterminableTideMode();
}

function pickActiveMode(mode: InterminableTideMode, req: Request): 'chaff' | 'jitter' | null {
  if (mode === 'off') return null;
  if (mode === 'chaff') return 'chaff';
  if (mode === 'jitter') return 'jitter';
  if (mode === 'both') {
    const ip = clientIp(req);
    const flip = (rateByIp.get(ip)?.count ?? 0) % 2 === 0;
    return flip ? 'chaff' : 'jitter';
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWavHeader(sampleRate = 192_000, channels = 2, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(0xffff_ffff, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(0xffff_ffff, 40);
  return header;
}

/** Minimal FLAC STREAMINFO block — valid magic, misleading max bitrate. */
function buildFlacPreamble(): Buffer {
  const block = Buffer.alloc(42);
  block.write('fLaC', 0);
  block[4] = 0x80;
  block[5] = 0x00;
  block[6] = 0x00;
  block[7] = 0x22;
  block[8] = 0x10;
  block[9] = 0x00;
  block[10] = 0x10;
  block[11] = 0x0f;
  block[12] = 0xf0;
  block[13] = 0x00;
  block[14] = 0x0b;
  block[15] = 0xb8;
  block[16] = 0x02;
  block.writeUInt32BE(1_411_200, 18);
  block.writeUInt32BE(1_411_200, 22);
  block.writeUInt32BE(0, 26);
  block.writeUInt16BE(4096, 30);
  block.writeUInt32BE(0, 32);
  block.writeUInt32BE(0, 36);
  block.writeUInt16BE(0, 40);
  return block;
}

function noiseChunk(size: number): Buffer {
  return randomBytes(size);
}

function tideResponseHeaders(res: Response, format: 'wav' | 'flac'): void {
  res.status(200);
  res.setHeader('Transfer-Encoding', 'chunked');
  res.removeHeader('Content-Length');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Interminable-Tide', '1');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Content-Type', format === 'flac' ? 'audio/flac' : 'audio/wav');
}

async function pumpInfinite(
  res: Response,
  produce: () => Buffer,
  maxDurationMs?: number,
): Promise<void> {
  const deadline = maxDurationMs ? Date.now() + maxDurationMs : null;
  const onClose = () => {
    /* client disconnect */
  };
  reqOnClose(res, onClose);

  try {
    while (!res.writableEnded && !res.destroyed) {
      if (deadline && Date.now() >= deadline) {
        res.end();
        return;
      }
      const chunk = produce();
      const ok = res.write(chunk);
      if (!ok) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
  } catch {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  }
}

function reqOnClose(res: Response, fn: () => void): void {
  res.on('close', fn);
}

export async function pipeChaffStream(
  res: Response,
  opts?: { format?: 'wav' | 'flac'; maxDurationMs?: number },
): Promise<void> {
  const format = opts?.format ?? (Math.random() > 0.5 ? 'wav' : 'flac');
  tideResponseHeaders(res, format);
  const preamble = format === 'flac' ? buildFlacPreamble() : buildWavHeader();
  res.write(preamble);
  await pumpInfinite(res, () => noiseChunk(CHUNK_BYTES), opts?.maxDurationMs);
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(filePath, { start: 0, end: maxBytes - 1 });
    stream.on('data', (c: Buffer) => {
      chunks.push(c);
      total += c.length;
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function pipeJitterStream(
  res: Response,
  opts?: { filePath?: string; maxDurationMs?: number },
): Promise<void> {
  const formats = ['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/ogg'] as const;
  let formatIdx = 0;
  tideResponseHeaders(res, 'wav');
  res.setHeader('Content-Type', formats[formatIdx]);

  if (opts?.filePath) {
    try {
      const prefix = await readFilePrefix(opts.filePath, 96 * 1024);
      res.write(prefix);
    } catch {
      res.write(buildWavHeader());
    }
  } else {
    res.write(buildWavHeader());
  }

  const deadline = opts?.maxDurationMs ? Date.now() + opts.maxDurationMs : null;

  try {
    while (!res.writableEnded && !res.destroyed) {
      if (deadline && Date.now() >= deadline) {
        res.end();
        return;
      }

      const delayMs = 40 + Math.floor(Math.random() * 1_960);
      await sleep(delayMs);

      formatIdx = (formatIdx + 1) % formats.length;
      res.write(`\r\n--tide\r\nContent-Type: ${formats[formatIdx]}\r\n\r\n`);

      const chunkSize = 4_096 + Math.floor(Math.random() * 60_000);
      const chunk = noiseChunk(chunkSize);
      const ok = res.write(chunk);
      if (!ok) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
  } catch {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  }
}

/**
 * Returns true when the response was handled by Interminable Tide.
 */
export async function maybeApplyInterminableTide(
  req: Request,
  res: Response,
  ctx: TideContext,
): Promise<boolean> {
  const debugTest = req.query.tide === 'test' && isLocalAdmin(req);
  if (!debugTest && !isDefenseProtocolEnabled()) return false;

  const mode = resolveTideMode(req);
  const active = pickActiveMode(mode, req);
  if (!active) return false;

  if (!debugTest) {
    const { flagged } = isFlaggedScraper(req, ctx);
    if (!flagged) return false;
  }

  const maxDurationMs =
    debugTest
      ? Math.min(30_000, Math.max(1_000, Number(req.query.maxSec ?? 5) * 1_000))
      : ctx.maxDurationMs;

  console.warn(
    `[tier34] interminable-tide ${active} path=${req.path} ip=${clientIp(req)} debug=${debugTest}`,
  );

  if (active === 'chaff') {
    await pipeChaffStream(res, { maxDurationMs });
  } else {
    await pipeJitterStream(res, { filePath: ctx.filePath, maxDurationMs });
  }
  return true;
}

export function registerInterminableTideRoutes(app: import('express').Express): void {
  app.get('/api/security/interminable-tide/test', async (req, res) => {
    if (!isDefenseProtocolEnabled()) {
      return res.status(403).json({ error: 'defense protocol must be enabled' });
    }
    if (!isLocalAdmin(req)) {
      return res.status(403).json({ error: 'local admin only' });
    }
    const mode = pickActiveMode(resolveTideMode(req), req) ?? 'chaff';
    const maxSec = Math.min(30, Math.max(1, Number(req.query.maxSec ?? 5)));
    if (mode === 'chaff') {
      await pipeChaffStream(res, { maxDurationMs: maxSec * 1_000 });
    } else {
      await pipeJitterStream(res, { maxDurationMs: maxSec * 1_000 });
    }
  });
}
