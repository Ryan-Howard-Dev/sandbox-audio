import { describe, expect, it } from 'vitest';
import {
  buildPlaylistAppShareUrl,
  buildSharedPlaylistManifest,
  parsePlaylistShareLink,
  sharedTracksToEnvelopes,
} from './playlistCollaborativeShare';
import type { StoredPlaylist } from './playlistStorage';

function samplePlaylist(): StoredPlaylist {
  return {
    id: 'playlist-1',
    name: 'Test Mix',
    description: 'For sharing',
    type: 'manual',
    updatedAt: 1_700_000_000_000,
    tracks: [
      {
        envelopeId: 'local-a',
        title: 'Alpha',
        artist: 'Artist One',
        album: 'Album',
        url: 'file://a.mp3',
        durationSeconds: 200,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: 'a',
      },
    ],
  };
}

describe('playlistCollaborativeShare', () => {
  it('builds share manifest from playlist', () => {
    const manifest = buildSharedPlaylistManifest(samplePlaylist(), true);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.name).toBe('Test Mix');
    expect(manifest.collaborative).toBe(true);
    expect(manifest.tracks).toHaveLength(1);
  });

  it('parses app hash links with optional edit token', () => {
    expect(parsePlaylistShareLink('#playlist=abc12345&token=deadbeefdeadbeef')).toEqual({
      shareId: 'abc12345',
      editToken: 'deadbeefdeadbeef',
    });
    expect(parsePlaylistShareLink('abc123456789abcd')).toEqual({
      shareId: 'abc123456789abcd',
    });
    expect(parsePlaylistShareLink('http://192.168.1.5:3001/api/playlists/share/abc12345')).toEqual({
      shareId: 'abc12345',
    });
  });

  it('builds app share url', () => {
    expect(buildPlaylistAppShareUrl('abc12345', 'tok')).toContain('#playlist=abc12345');
    expect(buildPlaylistAppShareUrl('abc12345', 'tok')).toContain('token=tok');
  });

  it('converts shared tracks to envelopes', () => {
    const envs = sharedTracksToEnvelopes([
      { title: 'Song', artist: 'Band', envelopeId: 'local-x', url: 'file://x.mp3', durationSeconds: 180 },
    ]);
    expect(envs[0]?.title).toBe('Song');
    expect(envs[0]?.provider).toBe('local-vault');
  });
});
