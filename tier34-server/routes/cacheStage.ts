/**
 * tmpfs stage-queue API — client reports active playback queue for RAM pre-cache.
 */

import type { Express } from 'express';
import {
  enqueueStageQueue,
  getTmpfsCacheStatus,
} from '../lib/tmpfsStageCache.js';

export function registerCacheStageRoutes(app: Express): void {
  app.get('/api/cache/status', (_req, res) => {
    try {
      res.json(getTmpfsCacheStatus());
    } catch (e) {
      console.error('[tier34] cache status', e);
      res.status(500).json({ error: 'cache status failed' });
    }
  });

  app.post('/api/cache/stage-queue', (req, res) => {
    const trackIds = Array.isArray(req.body?.trackIds)
      ? (req.body.trackIds as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
      : [];
    const envelopeIds = Array.isArray(req.body?.envelopeIds)
      ? (req.body.envelopeIds as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
      : [];

    if (trackIds.length === 0 && envelopeIds.length === 0) {
      return res.status(400).json({ error: 'trackIds or envelopeIds required' });
    }

    try {
      const result = enqueueStageQueue(trackIds, envelopeIds);
      res.json({ ok: true, ...result, status: getTmpfsCacheStatus() });
    } catch (e) {
      console.error('[tier34] cache stage-queue', e);
      res.status(500).json({ error: 'stage-queue failed' });
    }
  });
}
