/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./airGapMode', () => ({
  isAirGapEnabled: vi.fn(() => false),
}));

import { isAirGapEnabled } from './airGapMode';
import {
  createPodpingWatcher,
  extractCustomJsonOperations,
  fetchHeadBlockNumber,
  PODPING_CURSOR_KEY,
  PODPING_MAX_CATCHUP_BLOCKS,
  resolveStartBlock,
  type HiveRpc,
} from './podpingWatcher';

const podpingOp = (iri: string) => ({
  id: 'podping',
  json: JSON.stringify({ version: '1.0', medium: 'podcast', reason: 'update', iris: [iri] }),
});

/** A block in the array-pair operation shape. */
const blockWith = (iri: string) => ({
  transactions: [{ operations: [['custom_json', podpingOp(iri)]] }],
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(isAirGapEnabled).mockReturnValue(false);
});

describe('extractCustomJsonOperations', () => {
  /*
   * Hive has returned operations as [name, payload] pairs and as { type, value } objects across
   * API versions. Handling only one shape would give an empty stream indistinguishable from a
   * chain carrying no podpings.
   */
  it('reads the array-pair operation shape', () => {
    expect(extractCustomJsonOperations(blockWith('https://a.example/f.xml'))).toHaveLength(1);
  });

  it('reads the typed-object operation shape', () => {
    const block = {
      transactions: [
        { operations: [{ type: 'custom_json_operation', value: podpingOp('https://b/f.xml') }] },
      ],
    };
    expect(extractCustomJsonOperations(block)).toHaveLength(1);
  });

  it('ignores other operation types and malformed blocks', () => {
    expect(extractCustomJsonOperations({ transactions: [{ operations: [['vote', {}]] }] })).toEqual(
      [],
    );
    expect(extractCustomJsonOperations(null)).toEqual([]);
    expect(extractCustomJsonOperations({})).toEqual([]);
    expect(extractCustomJsonOperations({ transactions: [{}] })).toEqual([]);
  });
});

describe('resolveStartBlock', () => {
  it('starts at the head when there is no stored cursor', () => {
    expect(resolveStartBlock(null, 1_000)).toBe(1_000);
  });

  it('resumes at the block after the stored one', () => {
    expect(resolveStartBlock(900, 1_000)).toBe(901);
  });

  /*
   * Someone returning after a week wants what is publishing now, not a morning of metered data
   * replaying history — an hour of blocks is already 1,200 requests.
   */
  it('abandons a backlog that is too far behind', () => {
    const head = 1_000_000;
    expect(resolveStartBlock(1, head)).toBe(head - PODPING_MAX_CATCHUP_BLOCKS);
  });

  it('never runs ahead of the head', () => {
    expect(resolveStartBlock(2_000, 1_000)).toBe(1_000);
  });
});

describe('air gap', () => {
  it('reports no head block and never calls the node', async () => {
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    const rpc = vi.fn<HiveRpc>();
    expect(await fetchHeadBlockNumber(rpc)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  /* Air-gap can be switched on while a watcher is already running, so it is checked per tick. */
  it('stops an already-running watcher from fetching', async () => {
    const rpc = vi.fn<HiveRpc>();
    const watcher = createPodpingWatcher({
      rpc,
      getSubscribedFeedUrls: () => ['https://a.example/f.xml'],
      onUpdates: vi.fn(),
    });
    vi.mocked(isAirGapEnabled).mockReturnValue(true);
    expect(await watcher.tick()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('createPodpingWatcher', () => {
  const rpcFor = (head: number, blocks: Record<number, unknown>): HiveRpc =>
    vi.fn(async (method: string, params: unknown) => {
      if (method === 'condenser_api.get_dynamic_global_properties') {
        return { head_block_number: head };
      }
      if (method === 'condenser_api.get_block') {
        const [n] = params as [number];
        return blocks[n] ?? null;
      }
      return null;
    });

  it('reports only feeds this install follows', async () => {
    const onUpdates = vi.fn();
    const watcher = createPodpingWatcher({
      rpc: rpcFor(500, {
        500: {
          transactions: [
            { operations: [['custom_json', podpingOp('https://mine.example/f.xml')]] },
            { operations: [['custom_json', podpingOp('https://stranger.example/f.xml')]] },
          ],
        },
      }),
      getSubscribedFeedUrls: () => ['https://mine.example/f.xml'],
      onUpdates,
    });

    const updates = await watcher.tick();

    expect(updates.map((u) => u.iri)).toEqual(['https://mine.example/f.xml']);
    expect(onUpdates).toHaveBeenCalledTimes(1);
  });

  it('stays silent when nothing followed changed', async () => {
    const onUpdates = vi.fn();
    const watcher = createPodpingWatcher({
      rpc: rpcFor(500, { 500: blockWith('https://stranger.example/f.xml') }),
      getSubscribedFeedUrls: () => ['https://mine.example/f.xml'],
      onUpdates,
    });

    expect(await watcher.tick()).toEqual([]);
    expect(onUpdates).not.toHaveBeenCalled();
  });

  it('advances and persists the cursor so a restart does not replay', async () => {
    const watcher = createPodpingWatcher({
      rpc: rpcFor(500, { 500: blockWith('https://mine.example/f.xml'), 501: blockWith('https://mine.example/g.xml') }),
      getSubscribedFeedUrls: () => ['https://mine.example/f.xml', 'https://mine.example/g.xml'],
      onUpdates: vi.fn(),
    });

    await watcher.tick();
    expect(localStorage.getItem(PODPING_CURSOR_KEY)).toBe('500');
    await watcher.tick();
    expect(localStorage.getItem(PODPING_CURSOR_KEY)).toBe('501');
    expect(watcher.lastBlock).toBe(502);
  });

  /* The head has simply not advanced yet — hold position rather than skipping a block. */
  it('holds the cursor when a block is not available yet', async () => {
    const watcher = createPodpingWatcher({
      rpc: rpcFor(500, {}),
      getSubscribedFeedUrls: () => ['https://mine.example/f.xml'],
      onUpdates: vi.fn(),
    });

    await watcher.tick();
    await watcher.tick();

    expect(watcher.lastBlock).toBe(500);
    expect(localStorage.getItem(PODPING_CURSOR_KEY)).toBeNull();
  });

  it('survives a node that throws', async () => {
    const watcher = createPodpingWatcher({
      rpc: vi.fn(async () => {
        throw new Error('node down');
      }),
      getSubscribedFeedUrls: () => ['https://mine.example/f.xml'],
      onUpdates: vi.fn(),
    });

    await expect(watcher.tick()).resolves.toEqual([]);
  });
});
