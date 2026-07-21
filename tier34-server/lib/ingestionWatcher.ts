/**
 * Folder watcher — queues ingest-file jobs on add/change for audio files.
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

const WATCH_CONFIG_PATH = path.join(LOCKER_STORAGE_ROOT, 'watch-config.json');
const AUDIO_EXT_RE = /\.(mp3|flac|ogg|wav|m4a|opus|aac|webm)$/i;

export type WatchConfig = {
  enabled: boolean;
  path: string;
  filesProcessed: number;
  filesSkipped: number;
  lastEventAt: number | null;
  watching: boolean;
};

const DEFAULT_CONFIG: WatchConfig = {
  enabled: false,
  path: '',
  filesProcessed: 0,
  filesSkipped: 0,
  lastEventAt: null,
  watching: false,
};

let config: WatchConfig = { ...DEFAULT_CONFIG };
let watcher: FSWatcher | null = null;
const queuedPaths = new Set<string>();

function ensureStorageDir(): void {
  fs.mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
}

export function loadWatchConfig(): WatchConfig {
  ensureStorageDir();
  try {
    const raw = fs.readFileSync(WATCH_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WatchConfig>;
    config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      watching: Boolean(watcher),
    };
  } catch {
    config = { ...DEFAULT_CONFIG, watching: Boolean(watcher) };
  }
  return getWatchStatus();
}

function saveWatchConfig(): void {
  ensureStorageDir();
  const toSave: WatchConfig = {
    ...config,
    watching: Boolean(watcher),
  };
  fs.writeFileSync(WATCH_CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
}

export function getWatchStatus(): WatchConfig {
  return {
    ...config,
    watching: Boolean(watcher),
  };
}

function isAudioPath(filePath: string): boolean {
  return AUDIO_EXT_RE.test(filePath);
}

function queueIngest(filePath: string): void {
  const normalized = path.resolve(filePath);
  if (!isAudioPath(normalized)) return;
  if (queuedPaths.has(normalized)) return;
  queuedPaths.add(normalized);
  setTimeout(() => queuedPaths.delete(normalized), 30_000);

  config.lastEventAt = Date.now();
  saveWatchConfig();
  void import('./ingestFileWorker.js').then((m) => {
    m.enqueueIngestFileJob(normalized);
  });
}

export function stopIngestionWatcher(): void {
  if (watcher) {
    void watcher.close();
    watcher = null;
  }
  config.watching = false;
  saveWatchConfig();
}

export function startIngestionWatcher(watchPath?: string): { ok: boolean; error?: string } {
  const target = (watchPath ?? config.path ?? process.env.TIER34_WATCH_PATH ?? '').trim();
  if (!target) {
    return { ok: false, error: 'watch path not configured' };
  }

  if (!fs.existsSync(target)) {
    return { ok: false, error: `path does not exist: ${target}` };
  }

  stopIngestionWatcher();

  config.path = target;
  config.enabled = true;
  config.watching = true;

  watcher = chokidar.watch(target, {
    persistent: true,
    ignoreInitial: false,
    depth: 99,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 400 },
    ignored: (filePath, stats) => {
      if (stats?.isDirectory()) return false;
      const base = path.basename(filePath);
      if (base.startsWith('.')) return true;
      return !isAudioPath(filePath);
    },
  });

  watcher.on('add', (p) => queueIngest(p));
  watcher.on('change', (p) => queueIngest(p));
  watcher.on('error', (err) => {
    console.error('[tier34] ingestion watcher error', err);
  });

  saveWatchConfig();
  void import('./ingestFileWorker.js').then((m) => m.initIngestPump());
  console.log(`[tier34] ingestion watcher active: ${target}`);
  return { ok: true };
}

export function setWatchConfig(input: {
  enabled?: boolean;
  path?: string;
}): WatchConfig {
  if (typeof input.path === 'string') {
    config.path = input.path.trim();
  }
  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
    if (input.enabled) {
      const result = startIngestionWatcher(config.path);
      if (!result.ok) {
        config.enabled = false;
        config.watching = false;
        saveWatchConfig();
        throw new Error(result.error ?? 'failed to start watcher');
      }
    } else {
      stopIngestionWatcher();
    }
  } else {
    saveWatchConfig();
  }
  return getWatchStatus();
}

/** Called on tier34 boot — start when env or saved config has a path. */
export function bootIngestionWatcher(): void {
  loadWatchConfig();
  const envPath = process.env.TIER34_WATCH_PATH?.trim();
  if (envPath && !config.path) {
    config.path = envPath;
  }
  if (config.enabled && config.path) {
    const result = startIngestionWatcher(config.path);
    if (!result.ok) {
      console.warn('[tier34] ingestion watcher not started:', result.error);
    }
  } else if (envPath) {
    config.enabled = true;
    const result = startIngestionWatcher(envPath);
    if (!result.ok) {
      console.warn('[tier34] TIER34_WATCH_PATH watcher failed:', result.error);
    }
  }
}

/** Increment processed/skipped counters (called from job completion hook). */
export function recordIngestOutcome(skipped: boolean): void {
  if (skipped) config.filesSkipped += 1;
  else config.filesProcessed += 1;
  saveWatchConfig();
}
