/**
 * LAN podcast feed mirror routes — subscriptions, pull, cached RSS.
 */

import type { Express, Request } from 'express';
import { verifyDeviceSyncAuth } from '../lib/deviceSecrets.js';
import {
  getMirrorStatus,
  loadMirrorFeedState,
  loadMirrorSubscriptions,
  mergeMirrorSubscriptions,
  removeMirrorSubscription,
  type PodcastMirrorSubscription,
} from '../lib/podcastMirrorStorage.js';
import { buildMirroredRssXml } from '../lib/podcastMirrorParser.js';
import {
  isPodcastMirrorEnabled,
  isPodcastMirrorPulling,
  pullAllMirrorFeeds,
  pullMirrorFeed,
} from '../lib/podcastMirrorWorker.js';
import { subscriptionFeedUrlId } from '../lib/podcastMirrorIds.js';

function requestBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${process.env.TIER34_PORT ?? 3001}`;
  return `${proto}://${host}`.replace(/\/$/, '');
}

function normalizeIncomingSubscription(raw: unknown): PodcastMirrorSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const feedUrl = String(row.feedUrl ?? '').trim();
  if (!feedUrl) return null;
  const id = String(row.id ?? '').trim() || subscriptionFeedUrlId(feedUrl);
  return {
    id,
    feedUrl,
    title: String(row.title ?? 'Podcast').trim() || 'Podcast',
    description: row.description ? String(row.description) : undefined,
    artworkUrl: row.artworkUrl ? String(row.artworkUrl) : undefined,
    subscribedAt:
      typeof row.subscribedAt === 'number' && Number.isFinite(row.subscribedAt)
        ? row.subscribedAt
        : Date.now(),
    enabled: row.enabled !== false,
    source:
      row.source === 'youtube' || row.source === 'opml' || row.source === 'rss'
        ? row.source
        : 'rss',
  };
}

export function registerPodcastMirrorRoutes(app: Express): void {
  app.get('/api/podcast/mirror/status', (_req, res) => {
    res.json(getMirrorStatus(isPodcastMirrorEnabled()));
  });

  app.get('/api/podcast/mirror/subscriptions', (_req, res) => {
    const store = loadMirrorSubscriptions();
    res.json({
      subscriptions: store.subscriptions,
      updatedAt: store.updatedAt,
      pulling: isPodcastMirrorPulling(),
    });
  });

  app.put('/api/podcast/mirror/subscriptions', (req, res) => {
    const auth = verifyDeviceSyncAuth(req);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });

    const body = req.body as { subscriptions?: unknown[]; removeIds?: string[] };
    const incoming = Array.isArray(body?.subscriptions)
      ? body.subscriptions.map(normalizeIncomingSubscription).filter(Boolean)
      : [];
    const merged = mergeMirrorSubscriptions(incoming as PodcastMirrorSubscription[]);
    if (Array.isArray(body?.removeIds)) {
      for (const id of body.removeIds) {
        if (typeof id === 'string') removeMirrorSubscription(id.trim());
      }
    }
    res.json({
      ok: true,
      subscriptionCount: merged.subscriptions.length,
      updatedAt: merged.updatedAt,
    });
  });

  app.post('/api/podcast/mirror/pull', async (req, res) => {
    const auth = verifyDeviceSyncAuth(req);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });
    if (!isPodcastMirrorEnabled()) {
      return res.status(503).json({ error: 'podcast mirror disabled' });
    }
    const feedId = String(req.query.feedId ?? req.body?.feedId ?? '').trim();
    try {
      const results = feedId ? [await pullMirrorFeed(feedId)] : await pullAllMirrorFeeds();
      res.json({ ok: true, results });
    } catch (e) {
      console.error('[tier34] podcast mirror pull', e);
      res.status(500).json({ error: 'mirror pull failed' });
    }
  });

  app.get('/api/podcast/mirror/feeds/:feedId/rss', (req, res) => {
    const feedId = String(req.params.feedId ?? '').trim();
    const state = loadMirrorFeedState(feedId);
    if (!state) {
      return res.status(404).send('Mirror feed not found');
    }
    const mirrored = state.episodes
      .filter((ep) => ep.blobHash)
      .map((ep) => ({
        id: ep.id,
        guid: ep.guid,
        title: ep.title,
        description: ep.description,
        audioUrl: `/api/locker/blob/${ep.blobHash}`,
        audioType: ep.audioType,
        durationSeconds: ep.durationSeconds,
        publishedAt: ep.publishedAt,
        artworkUrl: ep.artworkUrl,
        blobUrl: `/api/locker/blob/${ep.blobHash}`,
        blobHash: ep.blobHash!,
      }));
    if (mirrored.length === 0) {
      return res.status(503).send('No mirrored episodes yet — wait for Tier34 pull');
    }
    const feed = {
      feedId: state.feedId,
      feedUrl: state.feedUrl,
      title: state.title,
      description: state.description,
      artworkUrl: state.artworkUrl,
      episodes: mirrored,
    };
    const xml = buildMirroredRssXml(feed, mirrored, requestBaseUrl(req));
    res.set('Content-Type', 'application/rss+xml; charset=utf-8').send(xml);
  });

  app.get('/api/podcast/mirror/feeds/:feedId', (req, res) => {
    const feedId = String(req.params.feedId ?? '').trim();
    const state = loadMirrorFeedState(feedId);
    if (!state) return res.status(404).json({ error: 'mirror feed not found' });
    const mirroredCount = state.episodes.filter((e) => e.blobHash).length;
    res.json({
      ...state,
      mirroredCount,
      episodeCount: state.episodes.length,
    });
  });
}
