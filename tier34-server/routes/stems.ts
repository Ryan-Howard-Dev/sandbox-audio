/**
 * Stem separation API — analyze jobs + stem URL lookup.
 */

import type { Express } from 'express';
import { demucsAvailable } from '../lib/demucsRunner.js';
import { loadMasterManifest } from '../lib/lockerStorage.js';
import {
  createStemAnalyzeJob,
  getStemAnalyzeJob,
  initStemWorker,
} from '../lib/stemWorker.js';
import { getStemEntry, stemUrlsForTrack } from '../lib/stemStorage.js';

export function registerStemsRoutes(app: Express): void {
  initStemWorker();

  app.get('/api/stems/capabilities', async (_req, res) => {
    const available = await demucsAvailable();
    res.json({
      demucsAvailable: available,
      hint: available
        ? 'Demucs ready — POST /api/stems/analyze to separate locker tracks.'
        : 'Demucs not installed. On the server host run: docker compose --profile stems up',
    });
  });

  app.post('/api/stems/analyze', (req, res) => {
    const { trackId, contentHash, title, artist } = req.body ?? {};
    if (!trackId || typeof trackId !== 'string') {
      res.status(400).json({ error: 'trackId required' });
      return;
    }
    let hash = typeof contentHash === 'string' ? contentHash.trim() : '';
    const tid = trackId.trim();
    if (!hash) {
      const manifest = loadMasterManifest();
      const entry = manifest.entries.find((e) => e.id === tid);
      if (entry?.contentHash) hash = entry.contentHash;
    }
    if (!hash && /^[a-f0-9]{64}$/i.test(tid)) {
      hash = tid.toLowerCase();
    }
    if (!hash) {
      res.status(400).json({
        error: 'contentHash required — sync track to Sandbox Server locker manifest first',
      });
      return;
    }
    const job = createStemAnalyzeJob({
      trackId: tid,
      contentHash: hash,
      title: typeof title === 'string' ? title : undefined,
      artist: typeof artist === 'string' ? artist : undefined,
    });
    res.json({ jobId: job.id, status: job.status, progress: job.progress });
  });

  app.get('/api/stems/status/:jobId', (req, res) => {
    const job = getStemAnalyzeJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json(job);
  });

  app.get('/api/stems/track/:trackId', (req, res) => {
    const entry = getStemEntry(req.params.trackId);
    if (!entry?.stems || Object.keys(entry.stems).length < 4) {
      res.status(404).json({ error: 'stems not found for track' });
      return;
    }
    const proto = req.headers['x-forwarded-proto'];
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const baseUrl = `${proto === 'https' ? 'https' : 'http'}://${host}`;
    const stemUrls = stemUrlsForTrack(req.params.trackId, baseUrl);
    res.json({
      trackId: entry.trackId,
      sourceHash: entry.sourceHash,
      stemUrls,
      analyzedAt: entry.analyzedAt,
    });
  });
}
