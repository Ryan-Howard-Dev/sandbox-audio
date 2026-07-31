import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  E2E_LOCKER_FIXTURE_ALBUM,
  E2E_LOCKER_FIXTURE_ARTIST,
  E2E_LOCKER_FIXTURE_TITLE,
  handleE2eAction,
  registerE2eHandlers,
} from './e2eDevAction';

vi.mock('./nativeExoStreamResolver', () => ({
  pickMobileExoPlayUrlAsync: vi.fn(async (resolved: { uri: string }) => resolved.uri),
  pickMobileExoPlayUrl: vi.fn((resolved: { uri: string }) => resolved.uri),
}));

vi.mock('./ytDlpMobile', () => ({
  getYtDlpMobileStatus: vi.fn(async () => ({
    available: true,
    initialized: true,
    version: '2024.1',
  })),
  waitForYtDlpInit: vi.fn(async () => true),
  resolveViaYtDlpMobile: vi.fn(async () => null),
}));

vi.mock('./androidNativePlayback', () => ({
  prepareNativeExoPlayback: vi.fn(async () => ({ ok: true, message: 'ready' })),
  nativeExoPlayUrl: vi.fn(async () => {}),
  nativeExoResume: vi.fn(async () => {}),
  nativeExoStop: vi.fn(async () => {}),
  nativeExoSeek: vi.fn(async () => {}),
  nativeExoEnqueueNext: vi.fn(async () => {}),
  getNativeExoPlaybackStatus: vi.fn(async () => ({
    available: true,
    wired: true,
    message: 'ok',
    state: 'idle' as const,
    positionSecs: 0,
    durationSecs: 0,
    queueLength: 1,
    currentUrl: '',
  })),
}));

vi.mock('./mobileResolverRegistry', () => ({
  refreshYtDlpMobileStub: vi.fn(),
  setMobileResolverEnabled: vi.fn(),
  getEnabledMobileResolvers: vi.fn(() => [{ id: 'yt-dlp-mobile', enabled: true }]),
  getMobileResolvers: vi.fn(() => [{ id: 'yt-dlp-mobile', name: 'yt-dlp (mobile)', enabled: true }]),
}));

vi.mock('./sandboxSettings', () => ({
  saveOnboardingComplete: vi.fn(),
  saveServerSetupComplete: vi.fn(),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => ''),
  saveTier34BackendUrl: vi.fn(),
  refreshTier34Reachability: vi.fn(async () => true),
  tier34HealthOk: vi.fn(async () => true),
  tier34FetchFeedResult: vi.fn(async () => ({ ok: true, items: [] })),
}));

vi.mock('./streamCache', () => ({
  clearStreamCache: vi.fn(async () => {}),
  clearUriResolutionCache: vi.fn(),
  getCachedStreamForTrack: vi.fn(() => null),
  isEnvelopeStreamCached: vi.fn(() => false),
}));

vi.mock('./playUrlCache', () => ({
  clearPlayUrlCache: vi.fn(),
}));

vi.mock('./play/ensureLockerPlayable', () => ({
  ensureLockerPlayable: vi.fn(async () => ({ kind: 'missing-audio' as const })),
  envelopeClaimsLocker: vi.fn(() => true),
  shouldRunLockerPlaybackGate: vi.fn(() => true),
  isImmediateLocalPlayable: vi.fn(() => false),
}));

vi.mock('./lockerStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lockerStorage')>();
  return {
    ...actual,
    getLockerEntries: vi.fn(async () => []),
    getLockerEntriesSnapshot: vi.fn(() => []),
    findLockerEntryForTrack: vi.fn(() => null),
    findPlayableLockerEntryForTrack: vi.fn(async () => null),
    findLockerEntryForTrackIncludingHollow: vi.fn(() => null),
    resolveLockerEnvelopeForPlayback: vi.fn(async () => null),
    lockerEntryIsPlayable: vi.fn(async () => false),
  };
});

function captureE2eAreas(warns: string[]): string[] {
  return warns
    .filter((line) => line.includes('[SandboxE2E]'))
    .map((line) => {
      const match = line.match(/AREA=([^\s]+)/);
      return match?.[1] ?? '';
    })
    .filter(Boolean);
}

describe('play-offline instrumentation', () => {
  let warns: string[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warns = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('emits lookup/envelope/playurl markers before final play-offline FAIL when entry missing', async () => {
    const playLockerTrack = vi.fn(async () => false);
    registerE2eHandlers({
      playLockerTrack,
      getPlaybackProbe: () => ({
        title: '',
        artist: '',
        state: 'Idle',
        positionSecs: 0,
        durationSecs: 0,
      }),
    });

    const params = new URLSearchParams({
      artist: E2E_LOCKER_FIXTURE_ARTIST,
      track: E2E_LOCKER_FIXTURE_TITLE,
      // omit album — album path waits up to 120s for queueLength>=2
    });
    await expect(handleE2eAction('play-offline', params)).resolves.toBe(false);

    const areas = captureE2eAreas(warns);
    expect(areas).toContain('play-offline-start');
    expect(areas).toContain('play-offline-lookup');
    expect(areas).toContain('play-offline-envelope');
    expect(areas).toContain('play-offline-playurl');
    expect(areas).toContain('play-offline-invoke');
    expect(areas).toContain('play-offline');

    expect(areas.indexOf('play-offline-start')).toBeLessThan(areas.indexOf('play-offline-lookup'));
    expect(areas.indexOf('play-offline-lookup')).toBeLessThan(areas.indexOf('play-offline-envelope'));
    expect(areas.indexOf('play-offline-envelope')).toBeLessThan(areas.indexOf('play-offline-playurl'));
    expect(areas.indexOf('play-offline-invoke')).toBeLessThan(areas.indexOf('play-offline'));

    expect(warns.some((w) => w.includes('AREA=play-offline-lookup RESULT=FAIL'))).toBe(true);
    expect(warns.some((w) => w.includes('AREA=play-offline RESULT=FAIL'))).toBe(true);
    expect(playLockerTrack).toHaveBeenCalledWith(
      E2E_LOCKER_FIXTURE_ARTIST,
      E2E_LOCKER_FIXTURE_TITLE,
      undefined,
    );
  });

  it('logs intended content:// URI when ensureLockerPlayable returns playable envelope', async () => {
    const { findLockerEntryForTrack } = await import('./lockerStorage');
    const { ensureLockerPlayable } = await import('./play/ensureLockerPlayable');
    const entry = {
      id: 'locker-e2e-1',
      title: E2E_LOCKER_FIXTURE_TITLE,
      artist: E2E_LOCKER_FIXTURE_ARTIST,
      albumName: E2E_LOCKER_FIXTURE_ALBUM,
      genre: 'Downloaded',
      durationSeconds: 12,
      url: 'blob:http://localhost/fake',
      addedAt: Date.now(),
      offlineReady: true,
    };
    vi.mocked(findLockerEntryForTrack).mockReturnValue(entry as never);
    vi.mocked(ensureLockerPlayable).mockResolvedValue({
      kind: 'playable',
      envelope: {
        envelopeId: 'local-locker-e2e-1',
        title: E2E_LOCKER_FIXTURE_TITLE,
        artist: E2E_LOCKER_FIXTURE_ARTIST,
        album: E2E_LOCKER_FIXTURE_ALBUM,
        durationSeconds: 12,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: 'locker-e2e-1',
        url: 'content://rd.sheepskin.sandboxmusic.locker/locker-e2e-1',
      },
    });

    registerE2eHandlers({
      playLockerTrack: vi.fn(async () => false),
      getPlaybackProbe: () => ({
        title: '',
        artist: '',
        state: 'Idle',
        positionSecs: 0,
        durationSecs: 0,
      }),
    });

    const params = new URLSearchParams({
      artist: E2E_LOCKER_FIXTURE_ARTIST,
      track: E2E_LOCKER_FIXTURE_TITLE,
      album: E2E_LOCKER_FIXTURE_ALBUM,
    });
    await expect(handleE2eAction('play-offline', params)).resolves.toBe(false);

    expect(
      warns.some(
        (w) =>
          w.includes('AREA=play-offline-envelope RESULT=PASS') &&
          w.includes('provider=local-vault') &&
          w.includes('urlScheme=content') &&
          w.includes('content://rd.sheepskin.sandboxmusic.locker/locker-e2e-1'),
      ),
    ).toBe(true);
    expect(
      warns.some(
        (w) =>
          w.includes('AREA=play-offline-lookup RESULT=PASS') &&
          w.includes('key=findLockerEntryForTrack+album') &&
          w.includes('entryId=locker-e2e-1'),
      ),
    ).toBe(true);
    expect(
      warns.some(
        (w) =>
          w.includes('AREA=play-offline-playurl') &&
          w.includes('intendedUri=content://rd.sheepskin.sandboxmusic.locker/locker-e2e-1'),
      ),
    ).toBe(true);
  });

  it('with album param does not block on queueLength>=2 before final RESULT', async () => {
    const { findLockerEntryForTrack } = await import('./lockerStorage');
    const { ensureLockerPlayable } = await import('./play/ensureLockerPlayable');
    const { getNativeExoPlaybackStatus } = await import('./androidNativePlayback');
    const entry = {
      id: 'locker-e2e-2',
      title: E2E_LOCKER_FIXTURE_TITLE,
      artist: E2E_LOCKER_FIXTURE_ARTIST,
      albumName: E2E_LOCKER_FIXTURE_ALBUM,
      genre: 'Downloaded',
      durationSeconds: 12,
      url: 'content://rd.sheepskin.sandboxmusic.locker/locker-e2e-2',
      addedAt: Date.now(),
      offlineReady: true,
    };
    vi.mocked(findLockerEntryForTrack).mockReturnValue(entry as never);
    vi.mocked(ensureLockerPlayable).mockResolvedValue({
      kind: 'playable',
      envelope: {
        envelopeId: 'local-locker-e2e-2',
        title: E2E_LOCKER_FIXTURE_TITLE,
        artist: E2E_LOCKER_FIXTURE_ARTIST,
        album: E2E_LOCKER_FIXTURE_ALBUM,
        durationSeconds: 12,
        provider: 'local-vault',
        transport: 'element-src',
        sourceId: 'locker-e2e-2',
        url: entry.url,
      },
    });
    vi.mocked(getNativeExoPlaybackStatus).mockResolvedValue({
      available: true,
      wired: true,
      message: 'ok',
      state: 'playing',
      positionSecs: 1.5,
      durationSecs: 12,
      queueLength: 1,
      currentUrl: entry.url,
    });

    registerE2eHandlers({
      playLockerTrack: vi.fn(async () => true),
      getPlaybackProbe: () => ({
        title: E2E_LOCKER_FIXTURE_TITLE,
        artist: E2E_LOCKER_FIXTURE_ARTIST,
        album: E2E_LOCKER_FIXTURE_ALBUM,
        state: 'Playing',
        nativeState: 'playing',
        positionSecs: 1.5,
        durationSecs: 12,
      }),
    });

    const params = new URLSearchParams({
      artist: E2E_LOCKER_FIXTURE_ARTIST,
      track: E2E_LOCKER_FIXTURE_TITLE,
      album: E2E_LOCKER_FIXTURE_ALBUM,
    });
    const started = Date.now();
    await expect(handleE2eAction('play-offline', params)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);

    expect(
      warns.some((w) => w.includes('AREA=play-offline-queue-wait') && w.includes('non-blocking')),
    ).toBe(true);
    expect(warns.some((w) => w.includes('AREA=play-offline RESULT=PASS'))).toBe(true);
  });
});
