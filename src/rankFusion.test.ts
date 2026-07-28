import { describe, expect, it } from 'vitest';
import { RRF_K, fuseRankedLists, fusionConsensus } from './rankFusion';

interface Row {
  id: string;
  title: string;
}

const byId = (row: Row) => row.id;

function rows(...ids: string[]): Row[] {
  return ids.map((id) => ({ id, title: id }));
}

describe('fuseRankedLists', () => {
  it('scores a single list by reciprocal rank', () => {
    const fused = fuseRankedLists([{ source: 'itunes', items: rows('a', 'b') }], byId);
    expect(fused.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 10);
    expect(fused[1]!.score).toBeCloseTo(1 / (RRF_K + 2), 10);
  });

  it('lifts a result two sources agree on above either list leader', () => {
    // Neither list puts "shared" first, but both rank it well — which is the signal RRF exists to
    // read. A merge that just concatenated by source order would bury it.
    const fused = fuseRankedLists(
      [
        { source: 'locker', items: rows('locker-top', 'shared') },
        { source: 'itunes', items: rows('itunes-top', 'shared') },
      ],
      byId,
    );
    expect(fused[0]!.item.id).toBe('shared');
    expect(fusionConsensus(fused[0]!)).toBe(2);
  });

  it('rescues the right track when a local parse ranked it badly', () => {
    // The real failure: parseCombinedTrackQuery guessed the artist was "humble", so the locker
    // scored the correct track poorly. iTunes still returned it first. Fusion has to put it back
    // on top — that is what makes a wrong guess cost ranking rather than the result.
    const locker: Row[] = [
      ...rows(...Array.from({ length: 14 }, (_, i) => `noise-${i}`)),
      { id: 'humble', title: 'HUMBLE. — Kendrick Lamar' },
    ];
    const itunes: Row[] = [
      { id: 'humble', title: 'HUMBLE. — Kendrick Lamar' },
      ...rows('other-1', 'other-2'),
    ];

    const fused = fuseRankedLists(
      [
        { source: 'locker', items: locker },
        { source: 'itunes', items: itunes },
      ],
      byId,
    );

    expect(fused[0]!.item.id).toBe('humble');
    expect(fused[0]!.sources).toEqual(['locker', 'itunes']);
    // Rank 15 locally + rank 1 on iTunes, per the RRF formula.
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 15) + 1 / (RRF_K + 1), 10);
  });

  it('does not let one source dominate the way raw scores would', () => {
    // A source that hands back 1000-point scores while another maxes out at 1 would win outright
    // under any additive scheme. Rank fusion never sees those numbers.
    const fused = fuseRankedLists(
      [
        { source: 'shouty', items: rows('shouty-only') },
        { source: 'quiet-a', items: rows('consensus') },
        { source: 'quiet-b', items: rows('consensus') },
      ],
      byId,
    );
    expect(fused[0]!.item.id).toBe('consensus');
  });

  it('keeps the first source\'s copy of a duplicated item', () => {
    const fused = fuseRankedLists(
      [
        { source: 'locker', items: [{ id: 'x', title: 'local metadata' }] },
        { source: 'scraper', items: [{ id: 'x', title: 'scraped metadata' }] },
      ],
      byId,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]!.item.title).toBe('local metadata');
    expect(fused[0]!.sources).toEqual(['locker', 'scraper']);
  });

  it('records the best rank across lists', () => {
    const fused = fuseRankedLists(
      [
        { source: 'a', items: rows('p', 'q', 'target') },
        { source: 'b', items: rows('target') },
      ],
      byId,
    );
    const target = fused.find((r) => r.item.id === 'target')!;
    expect(target.bestRank).toBe(1);
  });

  it('weights a trusted source without reintroducing raw scores', () => {
    const lists = [
      { source: 'locker', items: rows('mine'), weight: 3 },
      { source: 'scraper', items: rows('theirs') },
    ];
    const fused = fuseRankedLists(lists, byId);
    expect(fused[0]!.item.id).toBe('mine');
    expect(fused[0]!.score).toBeCloseTo(3 / (RRF_K + 1), 10);
  });

  it('drops a source weighted to zero', () => {
    const fused = fuseRankedLists(
      [
        { source: 'off', items: rows('hidden'), weight: 0 },
        { source: 'on', items: rows('shown') },
      ],
      byId,
    );
    expect(fused.map((r) => r.item.id)).toEqual(['shown']);
  });

  it('breaks an exact score tie by best rank', () => {
    const fused = fuseRankedLists(
      [
        { source: 'a', items: rows('first') },
        { source: 'b', items: rows('also-first') },
      ],
      byId,
    );
    // Identical scores; stable order is all that is promised, but both must survive.
    expect(fused).toHaveLength(2);
    expect(fused.every((r) => r.bestRank === 1)).toBe(true);
  });

  it('survives empty, missing and malformed lists', () => {
    const fused = fuseRankedLists(
      [
        { source: 'empty', items: [] },
        // A scraper that failed mid-flight can hand back a non-array; a search must not die of it.
        { source: 'broken', items: undefined as unknown as Row[] },
        { source: 'good', items: rows('a') },
      ],
      byId,
    );
    expect(fused.map((r) => r.item.id)).toEqual(['a']);
  });

  it('skips items with no identity rather than merging them together', () => {
    const fused = fuseRankedLists(
      [{ source: 'a', items: [{ id: '', title: 'nameless' }, { id: 'real', title: 'real' }] }],
      byId,
    );
    expect(fused.map((r) => r.item.id)).toEqual(['real']);
  });

  it('skips an item whose identity function throws', () => {
    const fused = fuseRankedLists(
      [{ source: 'a', items: [{ id: 'boom', title: 'x' }, { id: 'ok', title: 'y' }] }],
      (row) => {
        if (row.id === 'boom') throw new Error('bad row');
        return row.id;
      },
    );
    expect(fused.map((r) => r.item.id)).toEqual(['ok']);
  });

  it('applies the limit after fusing, not before', () => {
    // The point of a late limit: something ranked 3rd everywhere can still finish first, and a
    // truncate-then-fuse order would have thrown it away before it could.
    const fused = fuseRankedLists(
      [
        { source: 'a', items: rows('x', 'y', 'shared') },
        { source: 'b', items: rows('p', 'q', 'shared') },
      ],
      byId,
      { limit: 1 },
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]!.item.id).toBe('shared');
  });

  it('returns nothing for no lists', () => {
    expect(fuseRankedLists([], byId)).toEqual([]);
  });

  it('honours a custom k', () => {
    // Small k sharpens the drop-off between ranks; large k flattens it toward pure consensus
    // counting. Worth being able to tune per pillar.
    const fused = fuseRankedLists([{ source: 'a', items: rows('one') }], byId, { k: 0 });
    expect(fused[0]!.score).toBeCloseTo(1, 10);
  });

  it('keeps a result only one source found', () => {
    // Consensus ranks higher, but a locker-only track must never vanish because iTunes has never
    // heard of it. This library is the user's own.
    const fused = fuseRankedLists(
      [
        { source: 'locker', items: rows('rare-bootleg') },
        { source: 'itunes', items: rows('a', 'b') },
        { source: 'youtube', items: rows('a') },
      ],
      byId,
    );
    expect(fused.map((r) => r.item.id)).toContain('rare-bootleg');
  });
});
