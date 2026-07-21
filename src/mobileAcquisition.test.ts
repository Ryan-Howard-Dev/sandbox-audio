import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./hybridResolution', () => ({
  buildPlayQueries: vi.fn(() => ['Kanye West KING']),
}));

vi.mock('./platformEnv', () => ({
  isAndroid: vi.fn(() => true),
}));

vi.mock('./mobileResolverRegistry', () => ({
  hasActiveMobileResolvers: vi.fn(() => true),
}));

vi.mock('./ytDlpMobile', () => ({
  waitForYtDlpInit: vi.fn(async () => true),
  downloadViaYtDlpMobile: vi.fn(async () => ({
    uri: 'file:///data/user/0/rd.sheepskin.sandboxmusic/cache/ytdlp-playback/abc.m4a',
    watchUrl: 'https://www.youtube.com/watch?v=abc',
    bitrate: 0,
    format: 'm4a',
  })),
  resolveViaYtDlpMobile: vi.fn(async () => null),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      convertFileSrc: vi.fn((path: string) => `capacitor://localhost/_capacitor_file_${path}`),
    },
  };
});

vi.mock('./lockerStorage', () => ({
  getLockerEntries: vi.fn(async () => []),
  getLockerEntriesSnapshot: vi.fn(() => []),
  saveLockerBlob: vi.fn(async (_blob: Blob, meta: { title: string; artist?: string; [key: string]: unknown }) => ({
    id: 'locker-test-1',
    title: meta.title,
    artist: meta.artist,
    genre: 'Downloaded',
    durationSeconds: 180,
    url: 'blob:test',
    addedAt: Date.now(),
  })),
  saveLockerBlobFromNativeFile: vi.fn(async (_uri: string, meta: { title: string; artist?: string; [key: string]: unknown }) => ({
    entry: {
      id: 'locker-test-1',
      title: meta.title,
      artist: meta.artist,
      genre: 'Downloaded',
      durationSeconds: 180,
      url: 'blob:test',
      addedAt: Date.now(),
    },
    bytes: 3,
  })),
  persistAlbumCoverForGroup: vi.fn(async () => true),
  persistOrphanTrackCover: vi.fn(async () => true),
  findLockerEntryForTrack: vi.fn(),
  findLockerEntryForTrackIncludingHollow: vi.fn(() => null),
  findPlayableLockerEntryForTrack: vi.fn(async () => null),
  resolveLockerReacquireTargetId: vi.fn(async () => undefined),
}));

import { acquireTracksOnMobile, canAcquireOnMobile } from './mobileAcquisition';
import { saveLockerBlobFromNativeFile } from './lockerStorage';

describe('mobileAcquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () =>
      Response.json({}, { status: 200 }),
    ) as unknown as typeof fetch;
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
    } as Response);
  });

  it('canAcquireOnMobile is true on Android with resolvers', () => {
    expect(canAcquireOnMobile()).toBe(true);
  });

  it('saves resolved track to locker', async () => {
    const result = await acquireTracksOnMobile(
      [
        {
          kind: 'track',
          id: 't1',
          title: 'KING',
          artist: 'Kanye West',
          durationSeconds: 200,
        },
      ],
      { mode: 'tracks' },
    );
    expect(result.saved).toBe(1);
    expect(result.failed).toBe(0);
    expect(saveLockerBlobFromNativeFile).toHaveBeenCalled();
  });
});
