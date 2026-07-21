/**
 * Per-show podcast rules API — LAN sync for auto-save / Wi‑Fi / retention.
 */

import type { Express } from 'express';
import { verifyDeviceSyncAuth } from '../lib/deviceSecrets.js';
import {
  listPodcastRules,
  mergePodcastRules,
  removePodcastRules,
  type StoredPodcastShowRules,
} from '../lib/podcastRulesStorage.js';

function normalizeRule(raw: unknown): StoredPodcastShowRules | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const feedId = String(row.feedId ?? '').trim();
  if (!feedId) return null;
  return {
    feedId,
    autoDownload: row.autoDownload === true,
    autoDownloadCount:
      typeof row.autoDownloadCount === 'number' && Number.isFinite(row.autoDownloadCount)
        ? Math.max(1, Math.min(10, Math.round(row.autoDownloadCount)))
        : undefined,
    wifiOnly: row.wifiOnly === true ? true : row.wifiOnly === false ? false : undefined,
    deletePlayedAfterDays:
      typeof row.deletePlayedAfterDays === 'number' && Number.isFinite(row.deletePlayedAfterDays)
        ? Math.max(0, Math.round(row.deletePlayedAfterDays))
        : undefined,
    updatedAt:
      typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now(),
  };
}

export function registerPodcastRulesRoutes(app: Express): void {
  app.get('/api/podcast/rules', (_req, res) => {
    const store = listPodcastRules();
    res.json({ rules: store, count: store.length });
  });

  app.put('/api/podcast/rules', (req, res) => {
    const auth = verifyDeviceSyncAuth(req);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });

    const body = req.body as { rules?: unknown[]; removeFeedIds?: string[] };
    const incoming = Array.isArray(body?.rules)
      ? body.rules.map(normalizeRule).filter(Boolean)
      : [];
    const merged = mergePodcastRules(incoming as StoredPodcastShowRules[]);
    if (Array.isArray(body?.removeFeedIds)) {
      for (const id of body.removeFeedIds) {
        if (typeof id === 'string') removePodcastRules(id.trim());
      }
    }
    res.json({
      ok: true,
      count: Object.keys(merged.rulesByFeedId).length,
      updatedAt: merged.updatedAt,
    });
  });
}
