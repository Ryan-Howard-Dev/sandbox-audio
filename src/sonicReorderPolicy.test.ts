import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import type { SonicFeatures } from './sonicFeatures';
import {
  analyzePlaylistSonicCoverage,
  buildSonicTrackNode,
  greedySonicReorder,
  pathTransitionCost,
  pickReorderStartIndex,
  reorderTracksBySonicPath,
  twoOptImprove,
} from './sonicReorderPolicy';

const sonicByTrackId = new Map<string, Partial<SonicFeatures>>();

vi.mock('./sonicFeatures', () => ({
  getSonicFeaturesForEnvelope: (track: MediaEnvelope) => {
    const id = track.sourceId ?? track.envelopeId;
    const partial = sonicByTrackId.get(id);
    if (!partial) return null;
    return {
      bpm: partial.bpm,
      energy: partial.energy ?? 0.5,
      camelot: partial.camelot,
      musicalKey: partial.musicalKey,
      source: partial.source ?? 'analyzed',
      analyzedAt: partial.analyzedAt ?? Date.now(),
    };
  },
}));

function track(id: string): MediaEnvelope {
  return {
    envelopeId: `local-${id}`,
    title: id,
    artist: 'Artist',
    album: 'Album',
    url: 'file://x',
    durationSeconds: 200,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('sonicReorderPolicy', () => {
  beforeEach(() => {
    sonicByTrackId.clear();
  });

  it('prefers high-energy keyed track as reorder start', () => {
    sonicByTrackId.set('a', { bpm: 120, energy: 0.3, camelot: '8A' });
    sonicByTrackId.set('b', { bpm: 122, energy: 0.9, camelot: '8A' });
    sonicByTrackId.set('c', { bpm: 124, energy: 0.5 });
    const nodes = [track('a'), track('b'), track('c')].map(buildSonicTrackNode);
    expect(pickReorderStartIndex(nodes)).toBe(1);
  });

  it('orders tracks by smooth BPM and key transitions', () => {
    sonicByTrackId.set('slow', { bpm: 100, energy: 0.9, camelot: '5A' });
    sonicByTrackId.set('mid', { bpm: 102, energy: 0.5, camelot: '5A' });
    sonicByTrackId.set('fast', { bpm: 130, energy: 0.4, camelot: '12A' });
    const input = [track('fast'), track('slow'), track('mid')];
    const out = reorderTracksBySonicPath(input);
    expect(out.map((t) => t.sourceId)).toEqual(['slow', 'mid', 'fast']);
  });

  it('twoOptImprove does not increase path cost', () => {
    sonicByTrackId.set('1', { bpm: 120, energy: 0.5, camelot: '8A' });
    sonicByTrackId.set('2', { bpm: 122, energy: 0.6, camelot: '8A' });
    sonicByTrackId.set('3', { bpm: 124, energy: 0.7, camelot: '9A' });
    sonicByTrackId.set('4', { bpm: 126, energy: 0.8, camelot: '9A' });
    const nodes = ['1', '2', '3', '4'].map((id) => buildSonicTrackNode(track(id)));
    const order = greedySonicReorder(nodes);
    const polished = twoOptImprove(order, nodes);
    expect(pathTransitionCost(polished, nodes)).toBeLessThanOrEqual(pathTransitionCost(order, nodes) + 1e-6);
  });

  it('reports sonic coverage detail levels', () => {
    sonicByTrackId.set('a', { bpm: 120, camelot: '8A' });
    sonicByTrackId.set('b', { bpm: 128 });
    sonicByTrackId.set('c', {});
    const coverage = analyzePlaylistSonicCoverage([track('a'), track('b'), track('c')]);
    expect(coverage).toEqual({ total: 3, withBpm: 2, withKey: 1, detail: 'full' });
  });
});
