/**
 * Hive block stream client for Podping.
 *
 * Reads blocks from a public Hive API node, pulls the custom_json operations out of them, and
 * hands them to the Podping parser. Hive produces a block every three seconds, so following the
 * head is a single small request on that cadence rather than a request per feed per hour.
 *
 * Three constraints shape this:
 *
 * - Air-gap must stop it dead. The check is at the top of every fetch, not only at start, because
 *   a listener can enable air-gap while a watcher is already running.
 * - Nothing is fetched on the strength of a stranger's announcement. This layer only reports which
 *   followed feeds changed; deciding to refetch a feed stays with the caller.
 * - A restart must not replay the chain. The cursor is persisted, and a stored position far behind
 *   the head is abandoned in favour of the head, since a listener wants today's episodes rather
 *   than a week of catch-up on a metered connection.
 */

import { isAirGapEnabled } from './airGapMode';
import {
  podpingUpdatesForSubscriptions,
  podpingUpdatesFromBlock,
  type HiveCustomJsonOperation,
  type PodpingUpdate,
} from './podping';

/** Public Hive API nodes. Rotated on failure — no single one is depended on. */
export const HIVE_API_NODES = [
  'https://api.hive.blog',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
];

export const PODPING_CURSOR_KEY = 'sandbox_podping_last_block';

/** Blocks arrive every three seconds; polling faster only wastes requests. */
export const PODPING_POLL_INTERVAL_MS = 3_000;

/**
 * Further behind than this and the backlog is abandoned for the head.
 *
 * An hour of blocks is already 1,200 requests to catch up on. Someone returning after a week wants
 * what is publishing now, not to spend their morning data replaying history.
 */
export const PODPING_MAX_CATCHUP_BLOCKS = 1_200;

export type HiveRpc = (method: string, params: unknown) => Promise<unknown>;

/** A Hive block, reduced to the part that matters here. */
interface HiveBlock {
  transactions?: Array<{ operations?: unknown }>;
}

/**
 * Custom_json operations in a block.
 *
 * Hive has carried operations as `[name, payload]` pairs and as `{ type, value }` objects across
 * API versions, and a node may return either. Reading only one shape would yield an empty stream
 * that looks exactly like a chain with no podpings on it.
 */
export function extractCustomJsonOperations(block: unknown): HiveCustomJsonOperation[] {
  const typed = block as HiveBlock | null;
  const transactions = Array.isArray(typed?.transactions) ? typed!.transactions : [];
  const out: HiveCustomJsonOperation[] = [];

  for (const transaction of transactions) {
    const operations = Array.isArray(transaction?.operations) ? transaction.operations : [];
    for (const operation of operations) {
      if (Array.isArray(operation) && operation.length >= 2) {
        const [name, payload] = operation as [unknown, unknown];
        if (name === 'custom_json' && payload && typeof payload === 'object') {
          out.push(payload as HiveCustomJsonOperation);
        }
        continue;
      }
      if (operation && typeof operation === 'object') {
        const wrapped = operation as { type?: unknown; value?: unknown };
        const type = typeof wrapped.type === 'string' ? wrapped.type : '';
        if (type.startsWith('custom_json') && wrapped.value && typeof wrapped.value === 'object') {
          out.push(wrapped.value as HiveCustomJsonOperation);
        }
      }
    }
  }
  return out;
}

/** Head block number, or null when the node cannot be reached or answers with nonsense. */
export async function fetchHeadBlockNumber(rpc: HiveRpc): Promise<number | null> {
  if (isAirGapEnabled()) return null;
  try {
    const result = (await rpc('condenser_api.get_dynamic_global_properties', [])) as
      | { head_block_number?: unknown }
      | null;
    const head = Number(result?.head_block_number ?? 0);
    return Number.isFinite(head) && head > 0 ? head : null;
  } catch {
    return null;
  }
}

/** One block, or null. A missing block is normal at the head and is simply retried. */
export async function fetchBlock(rpc: HiveRpc, blockNumber: number): Promise<unknown | null> {
  if (isAirGapEnabled()) return null;
  try {
    const result = (await rpc('condenser_api.get_block', [blockNumber])) as unknown;
    return result ?? null;
  } catch {
    return null;
  }
}

/** Where to resume from, given a stored cursor and the current head. */
export function resolveStartBlock(stored: number | null, head: number): number {
  if (!Number.isFinite(head) || head <= 0) return 0;
  if (!stored || !Number.isFinite(stored) || stored <= 0) return head;
  if (stored >= head) return head;
  if (head - stored > PODPING_MAX_CATCHUP_BLOCKS) return head - PODPING_MAX_CATCHUP_BLOCKS;
  return stored + 1;
}

function readCursor(): number | null {
  try {
    const raw = localStorage.getItem(PODPING_CURSOR_KEY);
    const value = Number(raw ?? 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeCursor(blockNumber: number): void {
  try {
    localStorage.setItem(PODPING_CURSOR_KEY, String(blockNumber));
  } catch {
    /* storage unavailable — the watcher still works, it just replays from the head next start */
  }
}

export interface PodpingWatcherOptions {
  rpc: HiveRpc;
  /** Feeds this install follows. Read per tick so new subscriptions are picked up live. */
  getSubscribedFeedUrls: () => Iterable<string>;
  /** Called only with updates for followed feeds. Never called with the raw firehose. */
  onUpdates: (updates: PodpingUpdate[]) => void;
  pollIntervalMs?: number;
}

export interface PodpingWatcher {
  start(): Promise<void>;
  stop(): void;
  /** Process one block. Exposed so the loop can be driven deterministically in tests. */
  tick(): Promise<PodpingUpdate[]>;
  get lastBlock(): number;
}

/**
 * A watcher over the Hive stream.
 *
 * Deliberately not started here — the caller decides when, so this never begins talking to a
 * network on import.
 */
export function createPodpingWatcher(options: PodpingWatcherOptions): PodpingWatcher {
  const interval = options.pollIntervalMs ?? PODPING_POLL_INTERVAL_MS;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const tick = async (): Promise<PodpingUpdate[]> => {
    if (isAirGapEnabled()) return [];
    if (cursor <= 0) {
      const head = await fetchHeadBlockNumber(options.rpc);
      if (!head) return [];
      cursor = resolveStartBlock(readCursor(), head);
      if (cursor <= 0) return [];
    }

    const block = await fetchBlock(options.rpc, cursor);
    // No block yet: the head has not advanced. Hold the cursor and try again next tick.
    if (!block) return [];

    const updates = podpingUpdatesFromBlock(extractCustomJsonOperations(block));
    writeCursor(cursor);
    cursor += 1;

    if (updates.length === 0) return [];
    const mine = podpingUpdatesForSubscriptions(updates, options.getSubscribedFeedUrls());
    if (mine.length > 0) options.onUpdates(mine);
    return mine;
  };

  const loop = async (): Promise<void> => {
    if (!running) return;
    try {
      await tick();
    } catch {
      /* a bad block or a node hiccup must not end the watch */
    }
    if (!running) return;
    timer = setTimeout(() => void loop(), interval);
  };

  return {
    async start() {
      if (running || isAirGapEnabled()) return;
      running = true;
      await loop();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    tick,
    get lastBlock() {
      return cursor;
    },
  };
}
