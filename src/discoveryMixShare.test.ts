import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import type { DiscoveryMix } from './discoveryMixes';
import { discoveryMixAsPlaylist } from './discoveryMixShare';
import { exportPlaylistAsM3U } from './playlistShareExport';

const mix: DiscoveryMix = {
  id: 'daily-2026-07-26',
  kind: 'daily-discovery',
  title: 'My Daily Discovery',
  subtitle: 'Songs by new and familiar artists',
  generatedAt: 1_753_500_000_000,
  tracks: [
    { envelopeId: 'a', title: 'CARNIVAL', artist: 'Kanye West', durationSeconds: 264 },
    { envelopeId: 'b', title: 'redrum', artist: '21 Savage', durationSeconds: 268 },
  ] as unknown as MediaEnvelope[],
};

describe('discoveryMixAsPlaylist', () => {
  it('carries the mix identity and tracks onto the playlist shape', () => {
    const playlist = discoveryMixAsPlaylist(mix);
    expect(playlist.name).toBe('My Daily Discovery');
    expect(playlist.description).toBe('Songs by new and familiar artists');
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.updatedAt).toBe(1_753_500_000_000);
  });

  it('namespaces the id so it cannot collide with a stored playlist', () => {
    expect(discoveryMixAsPlaylist(mix).id).toBe('discovery-mix-daily-2026-07-26');
  });

  it('produces an export the existing playlist helpers accept', () => {
    const m3u = exportPlaylistAsM3U(discoveryMixAsPlaylist(mix));
    expect(m3u).toContain('#PLAYLIST:My Daily Discovery');
    expect(m3u).toContain('21 Savage - redrum');
  });
});
