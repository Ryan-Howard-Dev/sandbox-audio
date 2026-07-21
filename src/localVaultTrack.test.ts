import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import { isLocalVaultEnvelope } from './localVaultTrack';

function env(partial: Partial<MediaEnvelope>): MediaEnvelope {
  return {
    envelopeId: 'local-1',
    title: 'Track',
    artist: 'Artist',
    url: 'https://example.com/a.mp3',
    durationSeconds: 200,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: '1',
    ...partial,
  };
}

describe('isLocalVaultEnvelope', () => {
  it('detects local-vault provider', () => {
    expect(isLocalVaultEnvelope(env({ provider: 'local-vault' }))).toBe(true);
  });

  it('detects blob URLs', () => {
    expect(isLocalVaultEnvelope(env({ provider: 'https', url: 'blob:http://localhost/x' }))).toBe(true);
  });

  it('returns false for remote streams', () => {
    expect(isLocalVaultEnvelope(env({ provider: 'https', url: 'https://cdn.example/x.mp3' }))).toBe(false);
  });
});
