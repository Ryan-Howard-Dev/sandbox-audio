import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from '../sandboxLayer1';

const { isAndroidMock, resolveMock, findMock, getSnapshotMock, isPlayableMock, refreshMock } =
  vi.hoisted(() => ({
    isAndroidMock: vi.fn(() => true),
    resolveMock: vi.fn(async () => null as MediaEnvelope | null),
    findMock: vi.fn(() => null),
    getSnapshotMock: vi.fn(() => []),
    isPlayableMock: vi.fn(async () => false),
    refreshMock: vi.fn(async () => []),
  }));

vi.mock('../platformEnv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platformEnv')>();
  return { ...actual, isAndroid: isAndroidMock };
});
vi.mock('../lockerStorage', () => ({
  findLockerEntryForTrack: findMock,
  findPlayableLockerEntryForTrack: vi.fn(async () => null),
  getLockerEntriesSnapshot: getSnapshotMock,
  resolveLockerEnvelopeForPlayback: resolveMock,
  lockerEntryIsPlayable: isPlayableMock,
  refreshLockerCache: refreshMock,
  pruneMetadataOnlyLockerDuplicates: vi.fn(async () => 0),
  reconcileLockerBlobIntegrity: vi.fn(async () => ({
    trackRows: 0,
    blobStoreKeys: 0,
    playable: 0,
    clearedFalseFlags: 0,
    healedFromBlobs: 0,
  })),
  warmLockerNativePlaybackCache: vi.fn(async () => 0),
}));
vi.mock('../nativeExoLockerBridge', () => ({
  isNativeExoPlayableUrl: (url: string) =>
    /^content:\/\//i.test(url) || /^https?:\/\//i.test(url),
}));

import { isImmediateLocalPlayable, ensureLockerPlayable, envelopeClaimsLocker } from './ensureLockerPlayable';

describe('ensureLockerPlayable', () => {
  beforeEach(() => {
    isAndroidMock.mockReturnValue(true);
    resolveMock.mockReset();
    findMock.mockReset();
    getSnapshotMock.mockReset();
    isPlayableMock.mockReset();
    refreshMock.mockReset();
  });

  it('rejects stale blob URLs for immediate Android locker play', () => {
    expect(
      isImmediateLocalPlayable({
        envelopeId: 'local-1',
        title: 'KING',
        artist: 'Kanye West',
        durationSeconds: 126,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: 'locker-1',
        url: 'blob:http://localhost/dead',
      }),
    ).toBe(false);
  });

  it('reports missing audio when locker metadata exists without bytes', async () => {
    resolveMock.mockResolvedValue(null);
    isPlayableMock.mockResolvedValue(false);

    const result = await ensureLockerPlayable({
      envelopeId: 'local-locker-1',
      title: 'KING',
      artist: 'Kanye West',
      durationSeconds: 126,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-1',
      url: 'blob:http://localhost/dead',
    });

    expect(result).toEqual({ kind: 'missing-audio' });
  });

  it('does not block streaming tracks that share a title with locker metadata', async () => {
    findMock.mockReturnValue({ id: 'locker-1', title: 'SPACE SONG', artist: 'Beach House' });
    resolveMock.mockResolvedValue(null);

    const result = await ensureLockerPlayable({
      envelopeId: 'search-hit-1',
      title: 'SPACE SONG',
      artist: 'Beach House',
      durationSeconds: 256,
      provider: 'https',
      transport: 'element-src',
      sourceId: 'search-hit-1',
      url: '',
    });

    expect(result).toEqual({ kind: 'not-locker' });
  });

  it('does not treat stream-cache blob URLs as locker claims', async () => {
    resolveMock.mockResolvedValue(null);

    const result = await ensureLockerPlayable({
      envelopeId: 'stream-1',
      title: 'Track',
      artist: 'Artist',
      durationSeconds: 200,
      provider: 'stream-cache',
      transport: 'element-src',
      sourceId: 'stream-1',
      url: 'blob:http://localhost/cache',
    });

    expect(result).toEqual({ kind: 'not-locker' });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('returns content URI envelope when locker resolves', async () => {
    resolveMock.mockResolvedValue({
      envelopeId: 'local-locker-1',
      title: 'KING',
      artist: 'Kanye West',
      durationSeconds: 126,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-1',
      url: 'content://rd.sheepskin.sandboxmusic.locker/locker-1',
    });

    const result = await ensureLockerPlayable({
      envelopeId: 'local-locker-1',
      title: 'KING',
      artist: 'Kanye West',
      durationSeconds: 126,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-1',
      url: 'blob:http://localhost/dead',
    });

    expect(result.kind).toBe('playable');
    if (result.kind === 'playable') {
      expect(result.envelope.url).toContain('content://');
    }
  });
});

describe('envelopeClaimsLocker', () => {
  it('claims local-vault envelopes', () => {
    expect(
      envelopeClaimsLocker({
        envelopeId: 'local-locker-1',
        title: 'Track',
        artist: 'Artist',
        durationSeconds: 200,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: 'locker-1',
        url: '',
      }),
    ).toBe(true);
  });

  it('does not claim stream-cache blob URLs without locker sourceId', () => {
    expect(
      envelopeClaimsLocker({
        envelopeId: 'stream-1',
        title: 'Track',
        artist: 'Artist',
        durationSeconds: 200,
        provider: 'stream-cache',
        transport: 'element-src',
        sourceId: 'stream-1',
        url: 'blob:http://localhost/cache',
      }),
    ).toBe(false);
  });
});
