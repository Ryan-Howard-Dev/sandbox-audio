import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playlistReorderCoverage,
  primePlaylistSonicAnalysis,
  smartReorderCoverageHint,
  smartReorderDetail,
  smartReorderPlaylistTracks,
  smartReorderToastMessage,
} from './playlistSmartReorder';
import type { MediaEnvelope } from './sandboxLayer1';
import type { SonicFeatures } from './sonicFeatures';

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
  lockerTrackKeyFromEnvelope: (track: MediaEnvelope) => track.sourceId ?? track.envelopeId,
}));

function track(id: string, title: string): MediaEnvelope {
  return {
    envelopeId: `local-${id}`,
    title,
    artist: 'A',
    album: 'B',
    url: 'file://x',
    durationSeconds: 200,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('playlistSmartReorder', () => {
  beforeEach(() => {
    sonicByTrackId.clear();
  });

  it('preserves all tracks', () => {
    const input = [track('1', 'One'), track('2', 'Two'), track('3', 'Three')];
    const out = smartReorderPlaylistTracks(input);
    expect(out.map((t) => t.envelopeId).sort()).toEqual(input.map((t) => t.envelopeId).sort());
  });

  it('returns single track unchanged', () => {
    const one = [track('1', 'One')];
    expect(smartReorderPlaylistTracks(one)).toEqual(one);
  });

  it('reports full detail when bpm and keys exist', () => {
    sonicByTrackId.set('1', { bpm: 120, camelot: '8A' });
    sonicByTrackId.set('2', { bpm: 122, camelot: '8A' });
    expect(smartReorderDetail([track('1', 'One'), track('2', 'Two')])).toBe('full');
  });

  it('reports bpm-only detail when keys are missing', () => {
    sonicByTrackId.set('1', { bpm: 120 });
    sonicByTrackId.set('2', { bpm: 128 });
    expect(smartReorderDetail([track('1', 'One'), track('2', 'Two')])).toBe('bpm');
  });

  it('prefers harmonically compatible adjacency when keys differ', () => {
    sonicByTrackId.set('a', { bpm: 120, energy: 0.8, camelot: '8A' });
    sonicByTrackId.set('b', { bpm: 122, energy: 0.5, camelot: '8A' });
    sonicByTrackId.set('c', { bpm: 121, energy: 0.5, camelot: '3B' });
    const out = smartReorderPlaylistTracks([track('c', 'C'), track('a', 'A'), track('b', 'B')]);
    const ids = out.map((t) => t.sourceId);
    expect(Math.abs(ids.indexOf('a') - ids.indexOf('b'))).toBe(1);
  });

  it('orders by BPM gradient when keys match within cluster', () => {
    sonicByTrackId.set('slow', { bpm: 100, energy: 0.9, camelot: '5A' });
    sonicByTrackId.set('mid', { bpm: 102, energy: 0.5, camelot: '5A' });
    sonicByTrackId.set('fast', { bpm: 130, energy: 0.4, camelot: '12A' });
    const out = smartReorderPlaylistTracks([
      track('fast', 'Fast'),
      track('slow', 'Slow'),
      track('mid', 'Mid'),
    ]);
    expect(out.map((t) => t.sourceId)).toEqual(['slow', 'mid', 'fast']);
  });

  it('exposes toast and coverage helpers', () => {
    sonicByTrackId.set('1', { bpm: 120, camelot: '8A' });
    sonicByTrackId.set('2', { bpm: 122 });
    const tracks = [track('1', 'One'), track('2', 'Two')];
    expect(smartReorderToastMessage(tracks)).toContain('BPM');
    expect(smartReorderCoverageHint(tracks)).toMatch(/BPM/);
    expect(playlistReorderCoverage(tracks).withKey).toBe(1);
  });
});
