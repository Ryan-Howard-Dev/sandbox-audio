/**
 * Local podcast transcript routes — Whisper on NAS, LAN search (no third-party APIs).
 */

import type { Express } from 'express';
import { verifyDeviceSyncAuth } from '../lib/deviceSecrets.js';
import {
  getTranscriptStatus,
  loadPodcastTranscript,
  searchPodcastTranscripts,
} from '../lib/podcastTranscriptStorage.js';
import {
  isPodcastTranscriptRunning,
  isPodcastWhisperEnabled,
  runPodcastTranscriptBatch,
  transcribeMirroredEpisode,
} from '../lib/podcastTranscriptWorker.js';
import { whisperAvailable, whisperModel } from '../lib/whisperRunner.js';

export function registerPodcastTranscriptRoutes(app: Express): void {
  app.get('/api/podcast/transcripts/status', async (_req, res) => {
    const available = await whisperAvailable();
    res.json({
      ...getTranscriptStatus(isPodcastWhisperEnabled(), available, whisperModel()),
      running: isPodcastTranscriptRunning(),
    });
  });

  app.get('/api/podcast/transcripts/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    if (q.length < 2) return res.json({ hits: [] });
    res.json({ hits: searchPodcastTranscripts(q, limit) });
  });

  app.get('/api/podcast/transcripts/:episodeId', (req, res) => {
    const episodeId = decodeURIComponent(String(req.params.episodeId ?? '').trim());
    if (!episodeId) return res.status(400).json({ error: 'episodeId required' });
    const row = loadPodcastTranscript(episodeId);
    if (!row) return res.status(404).json({ error: 'transcript not found' });
    res.json(row);
  });

  app.post('/api/podcast/transcripts/transcribe', async (req, res) => {
    const auth = verifyDeviceSyncAuth(req);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });
    if (!isPodcastWhisperEnabled()) {
      return res.status(503).json({ error: 'podcast whisper disabled' });
    }
    const episodeId = String(req.query.episodeId ?? req.body?.episodeId ?? '').trim();
    try {
      if (episodeId) {
        const result = await transcribeMirroredEpisode(episodeId);
        return res.json({ ok: result.ok, results: [result] });
      }
      const results = await runPodcastTranscriptBatch();
      res.json({ ok: true, results });
    } catch (e) {
      console.error('[tier34] podcast transcribe', e);
      res.status(500).json({ error: 'transcribe failed' });
    }
  });
}
