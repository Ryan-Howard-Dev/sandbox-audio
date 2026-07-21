/**
 * Per-show podcast rules store — synced across LAN devices via Tier34.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

export type StoredPodcastShowRules = {
  feedId: string;
  autoDownload?: boolean;
  autoDownloadCount?: number;
  wifiOnly?: boolean;
  deletePlayedAfterDays?: number;
  voiceBoostDefault?: boolean;
  updatedAt: number;
};

export type PodcastRulesStore = {
  version: 1;
  updatedAt: number;
  rulesByFeedId: Record<string, StoredPodcastShowRules>;
};

const RULES_DIR = join(LOCKER_STORAGE_ROOT, 'podcast-rules');
const RULES_FILE = join(RULES_DIR, 'rules.json');

function ensureDirs(): void {
  mkdirSync(RULES_DIR, { recursive: true });
}

function emptyStore(): PodcastRulesStore {
  return { version: 1, updatedAt: 0, rulesByFeedId: {} };
}

export function loadPodcastRulesStore(): PodcastRulesStore {
  if (!existsSync(RULES_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(RULES_FILE, 'utf8')) as PodcastRulesStore;
    if (!parsed?.rulesByFeedId || typeof parsed.rulesByFeedId !== 'object') {
      return emptyStore();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      rulesByFeedId: parsed.rulesByFeedId,
    };
  } catch {
    return emptyStore();
  }
}

function savePodcastRulesStore(store: PodcastRulesStore): void {
  ensureDirs();
  store.updatedAt = Date.now();
  writeFileSync(RULES_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function mergePodcastRules(
  incoming: StoredPodcastShowRules[],
): PodcastRulesStore {
  const store = loadPodcastRulesStore();
  for (const row of incoming) {
    const feedId = row.feedId?.trim();
    if (!feedId) continue;
    const updatedAt =
      typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now();
    const existing = store.rulesByFeedId[feedId];
    if (existing && existing.updatedAt > updatedAt) continue;
    store.rulesByFeedId[feedId] = {
      feedId,
      autoDownload: row.autoDownload,
      autoDownloadCount: row.autoDownloadCount,
      wifiOnly: row.wifiOnly,
      deletePlayedAfterDays: row.deletePlayedAfterDays,
      voiceBoostDefault: row.voiceBoostDefault,
      updatedAt,
    };
  }
  savePodcastRulesStore(store);
  return store;
}

export function listPodcastRules(): StoredPodcastShowRules[] {
  const store = loadPodcastRulesStore();
  return Object.values(store.rulesByFeedId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removePodcastRules(feedId: string): boolean {
  const store = loadPodcastRulesStore();
  if (!store.rulesByFeedId[feedId]) return false;
  delete store.rulesByFeedId[feedId];
  savePodcastRulesStore(store);
  return true;
}
