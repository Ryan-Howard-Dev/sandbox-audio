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
  searchYtDlpMobile: vi.fn(async () => [
    {
      id: 'abc',
      title: 'Kanye West - KING (Official Audio)',
      artist: 'YouTube',
      watchUrl: 'https://www.youtube.com/watch?v=abc',
      durationSeconds: 198,
    },
  ]),
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
import { downloadViaYtDlpMobile, searchYtDlpMobile } from './ytDlpMobile';

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

  it('saves resolved track to locker after identity verification', async () => {
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
    expect(searchYtDlpMobile).toHaveBeenCalled();
    expect(downloadViaYtDlpMobile).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=abc',
    );
    expect(saveLockerBlobFromNativeFile).toHaveBeenCalled();
  });

  it('does not store when only a live candidate is offered for a studio track', async () => {
    vi.mocked(searchYtDlpMobile).mockResolvedValueOnce([
      {
        id: 'live1',
        title: 'KING (Live from MSG)',
        artist: 'Kanye West',
        watchUrl: 'https://www.youtube.com/watch?v=live1',
        durationSeconds: 205,
      },
    ]);
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
    expect(result.saved).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatch(/Identity check blocked store|unrequested rendition/i);
    expect(saveLockerBlobFromNativeFile).not.toHaveBeenCalled();
    expect(downloadViaYtDlpMobile).not.toHaveBeenCalled();
  });
  /*
   * The whole point of the look-ahead: overlap the waiting, not the writing.
   *
   * A fifty-five track album used to resolve, save, resolve, save, strictly in turn, so it spent
   * most of its life on round trips it could have run underneath the save already in progress.
   * What must NOT be overlapped is the save — one transfer at a time is what keeps a source from
   * seeing a burst from us, and it is the reason this is a look-ahead and not a worker pool.
   */
  /*
   * The whole point of the look-ahead: overlap the waiting, not the writing.
   *
   * A fifty-five track album used to resolve, save, resolve, save, strictly in turn, so it spent
   * most of its life on round trips it could have run underneath the save already in progress.
   * What must NOT be overlapped is the save — one transfer at a time is what keeps a source from
   * seeing a burst from us, and it is the reason this is a look-ahead and not a worker pool.
   */
  it('resolves ahead while saving one track at a time', async () => {
    /*
     * mockResolvedValueOnce from an earlier test survives clearAllMocks — that clears call records,
     * not queued one-shot implementations — and a leaked live-candidate fixture here fails the
     * first identity check, which then poisons the negative cache for every later track.
     */
    vi.mocked(searchYtDlpMobile).mockReset();
    vi.mocked(saveLockerBlobFromNativeFile).mockReset();

    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    const tracks = titles.map((title, i) => ({
      kind: 'track' as const,
      id: `t${i}`,
      title,
      artist: 'Kanye West',
      durationSeconds: 200,
    }));

    let searchesInFlight = 0;
    let peakSearchesInFlight = 0;
    vi.mocked(searchYtDlpMobile).mockImplementation(async (query: string) => {
      searchesInFlight += 1;
      peakSearchesInFlight = Math.max(peakSearchesInFlight, searchesInFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      searchesInFlight -= 1;
      // Answer with the track that was actually asked for, so the identity check passes and what
      // is being measured is the scheduling rather than the matcher.
      const asked = titles.find((t) => query.includes(t)) ?? titles[0]!;
      return [
        {
          id: `yt-${asked}`,
          title: `Kanye West - ${asked} (Official Audio)`,
          artist: 'YouTube',
          watchUrl: `https://www.youtube.com/watch?v=${asked}`,
          durationSeconds: 198,
        },
      ];
    });

    let savesInFlight = 0;
    let peakSavesInFlight = 0;
    vi.mocked(saveLockerBlobFromNativeFile).mockImplementation(async () => {
      savesInFlight += 1;
      peakSavesInFlight = Math.max(peakSavesInFlight, savesInFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      savesInFlight -= 1;
      return { entry: { id: 'e1' }, bytes: 3 } as never;
    });

    const result = await acquireTracksOnMobile(tracks, { mode: 'tracks' });

    expect(result.saved).toBe(4);
    // Overlapped: the point of the change.
    expect(peakSearchesInFlight).toBeGreaterThan(1);
    // Never overlapped: the constraint the change had to respect.
    expect(peakSavesInFlight).toBe(1);
  });
});
