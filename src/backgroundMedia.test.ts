import { describe, expect, it } from 'vitest';
import type { MediaSessionTrackMetadata } from './keyboardShortcuts';

// Mirror private helper from backgroundMedia.ts for regression coverage.
function metadataIdentityKey(metadata: MediaSessionTrackMetadata): string {
  return [
    metadata.envelopeId ?? '',
    metadata.title,
    metadata.artist,
    metadata.album ?? '',
    metadata.artworkUrl ?? '',
  ].join('\u0001');
}

describe('lock screen metadata identity', () => {
  it('changes when envelope id changes even if title matches', () => {
    const base = {
      title: 'ROTTWEILER',
      artist: 'ESDEEKID',
    };
    expect(
      metadataIdentityKey({ ...base, envelopeId: 'a' }),
    ).not.toBe(metadataIdentityKey({ ...base, envelopeId: 'b' }));
  });

  it('changes when title changes for the same artist', () => {
    expect(
      metadataIdentityKey({ title: 'Metro Nights', artist: 'Metro Boomin' }),
    ).not.toBe(
      metadataIdentityKey({ title: 'ROTTWEILER', artist: 'ESDEEKID' }),
    );
  });
});

describe('nextAndroidMediaMetadataRevision', () => {
  it('returns strictly increasing revisions', async () => {
    const { nextAndroidMediaMetadataRevision } = await import('./backgroundMedia');
    const a = nextAndroidMediaMetadataRevision();
    const b = nextAndroidMediaMetadataRevision();
    expect(b).toBeGreaterThan(a);
  });
});
