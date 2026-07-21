/**
 * Sandbox Platform API — social, messages, marketplace, shares (outbox v0)
 * Spec: sandbox-os-core/docs/PLATFORM-API.md
 */

import type { Express, Request, Response } from 'express';
import {
  listOutboxEntries,
  listThreadsForKey,
  loadOutboxEntry,
  storeOutboxEntry,
  type OutboxEntryType,
} from '../lib/platformOutbox.js';

function parseType(raw: unknown): OutboxEntryType | undefined {
  if (raw === 'message' || raw === 'post' || raw === 'listing' || raw === 'share') return raw;
  return undefined;
}

export function registerPlatformRoutes(app: Express): void {
  /** Public + friends outbox feed (this node) */
  app.get('/api/social/outbox', (req: Request, res: Response) => {
    const type = parseType(req.query.type);
    const authorKeyId = typeof req.query.authorKeyId === 'string' ? req.query.authorKeyId : undefined;
    const visibility = req.query.visibility === 'public' ? 'public' : undefined;
    const entries = listOutboxEntries({
      type,
      authorKeyId,
      visibility: visibility as 'public' | undefined,
      limit: Number(req.query.limit) || 50,
    });
    res.json({ ok: true, entries, node: 'local' });
  });

  /** Publish to your outbox */
  app.post('/api/social/outbox', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const type = parseType(body.type);
    const authorKeyId = typeof body.authorKeyId === 'string' ? body.authorKeyId : '';
    if (!type || !authorKeyId) {
      res.status(400).json({ ok: false, error: 'type and authorKeyId required' });
      return;
    }
    const visibility =
      body.visibility === 'friends' ||
      body.visibility === 'direct' ||
      body.visibility === 'unlisted'
        ? body.visibility
        : 'public';
    const entry = storeOutboxEntry({
      type,
      authorKeyId,
      visibility,
      payload: body.payload ?? {},
      mediaRefs: Array.isArray(body.mediaRefs) ? (body.mediaRefs as string[]) : [],
      toKeyId: typeof body.toKeyId === 'string' ? body.toKeyId : undefined,
      threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
      signature: typeof body.signature === 'string' ? body.signature : undefined,
    });
    res.status(201).json({ ok: true, entry });
  });

  app.get('/api/social/outbox/:id', (req: Request, res: Response) => {
    const entry = loadOutboxEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json({ ok: true, entry });
  });

  /** SMS / WhatsApp-style threads */
  app.get('/api/social/threads', (req: Request, res: Response) => {
    const keyId = typeof req.query.keyId === 'string' ? req.query.keyId : '';
    if (!keyId) {
      res.status(400).json({ ok: false, error: 'keyId required' });
      return;
    }
    res.json({ ok: true, threads: listThreadsForKey(keyId) });
  });

  app.get('/api/social/threads/:threadId/messages', (req: Request, res: Response) => {
    const entries = listOutboxEntries({
      type: 'message',
      threadId: req.params.threadId,
      limit: 100,
    });
    entries.sort((a, b) => a.createdAt - b.createdAt);
    res.json({ ok: true, messages: entries });
  });

  /** Marketplace listings (type=listing in outbox) */
  app.get('/api/marketplace/listings', (_req: Request, res: Response) => {
    const listings = listOutboxEntries({ type: 'listing', visibility: 'public', limit: 100 });
    res.json({ ok: true, listings });
  });

  app.post('/api/marketplace/listings', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const authorKeyId = typeof body.authorKeyId === 'string' ? body.authorKeyId : '';
    if (!authorKeyId) {
      res.status(400).json({ ok: false, error: 'authorKeyId required' });
      return;
    }
    const entry = storeOutboxEntry({
      type: 'listing',
      authorKeyId,
      visibility: 'public',
      payload: body.payload ?? {},
      mediaRefs: Array.isArray(body.mediaRefs) ? (body.mediaRefs as string[]) : [],
      signature: typeof body.signature === 'string' ? body.signature : undefined,
    });
    res.status(201).json({ ok: true, listing: entry });
  });

  /** Art / music / ideas — generic share */
  app.post('/api/share', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const type = parseType(body.type) ?? 'share';
    const authorKeyId = typeof body.authorKeyId === 'string' ? body.authorKeyId : '';
    if (!authorKeyId) {
      res.status(400).json({ ok: false, error: 'authorKeyId required' });
      return;
    }
    const entry = storeOutboxEntry({
      type: type === 'listing' || type === 'message' || type === 'post' ? type : 'share',
      authorKeyId,
      visibility:
        body.visibility === 'friends' || body.visibility === 'unlisted' ? body.visibility : 'public',
      payload: body.payload ?? {},
      mediaRefs: Array.isArray(body.mediaRefs) ? (body.mediaRefs as string[]) : [],
      signature: typeof body.signature === 'string' ? body.signature : undefined,
    });
    res.status(201).json({ ok: true, share: entry });
  });

  /** Federation inbox — pull from friend node (v0.5 stub) */
  app.post('/api/social/inbox/pull', (req: Request, res: Response) => {
    const peerUrl = typeof req.body?.peerUrl === 'string' ? req.body.peerUrl : '';
    if (!peerUrl) {
      res.status(400).json({ ok: false, error: 'peerUrl required' });
      return;
    }
    res.status(501).json({
      ok: false,
      error: 'federation pull not implemented',
      peerUrl,
      hint: 'Phase 0.5 — signed GET /api/social/outbox on peer tier34',
    });
  });
}
