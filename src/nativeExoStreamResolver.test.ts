import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';

const { mockPlugin } = vi.hoisted(() => ({
  mockPlugin: {
    getLockerBlobUri: vi.fn(async () => ({})),
    beginLockerBlob: vi.fn(async () => ({ ok: true })),
    appendLockerBlobChunk: vi.fn(async () => ({ ok: true })),
    finishLockerBlob: vi.fn(async () => ({
      ok: true,
      contentUri: 'content://rd.sheepskin.sandboxmusic.locker/track-abc',
    })),
    abortLockerBlob: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      getPlatform: vi.fn(() => 'android'),
      isNativePlatform: vi.fn(() => true),
    },
    registerPlugin: vi.fn(() => mockPlugin),
  };
});

vi.mock('./lockerStorage', () => ({
  getLockerAudioBlob: vi.fn(async () => new Blob(['audio-bytes'], { type: 'audio/mpeg' })),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => 'http://192.168.1.10:3001'),
  appendSandboxClientQuery: vi.fn((url: string) => `${url}?sb_client=test`),
  isServerReachableCached: vi.fn(() => true),
}));

import {
  isOfflineUnplayableStreamUrl,
  needsNativeStreamResolution,
  pickMobileExoPlayUrl,
  resolveNativeExoStreamUrl,
  resolveNativeExoStreamUrlAsync,
  wrapGoogleStreamForExo,
} from './nativeExoStreamResolver';
import { getTier34BaseUrl, isServerReachableCached } from './tier34/client';
import { lockerIdFromEnvelope, registerLockerBlobContentUri } from './nativeExoLockerBridge';

const lockerEnvelope = (overrides?: Partial<MediaEnvelope>): MediaEnvelope => ({
  envelopeId: 'local-track-abc',
  title: 'Track',
  artist: 'Artist',
  url: 'blob:http://localhost/abc',
  durationSeconds: 180,
  provider: 'local-vault',
  transport: 'element-src',
  sourceId: 'track-abc',
  ...overrides,
});

describe('needsNativeStreamResolution', () => {
  it('detects blob and local-vault URLs', () => {
    expect(needsNativeStreamResolution('blob:x', 'local-vault')).toBe(true);
    expect(needsNativeStreamResolution('https://cdn.example/a.mp3')).toBe(false);
  });
});

describe('resolveNativeExoStreamUrl', () => {
  beforeEach(() => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://192.168.1.10:3001');
    vi.mocked(isServerReachableCached).mockReturnValue(true);
  });

  it('returns null for locker blob when no Sandbox Server is configured', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    expect(resolveNativeExoStreamUrl(lockerEnvelope())).toBeNull();
  });

  it('returns tier34 cast stream for locker sourceId when LAN base is set', () => {
    const url = resolveNativeExoStreamUrl(lockerEnvelope());
    expect(url).toContain('/api/cast/stream/track-abc');
    expect(url).toContain('sb_client=');
  });

  it('passes through non-YouTube HTTP URLs unchanged', () => {
    const http = 'https://cdn.example/track.flac';
    expect(resolveNativeExoStreamUrl(lockerEnvelope({ url: http }))).toBe(http);
  });

  it('proxies googlevideo URLs through tier34 when server is configured and reachable', () => {
    const google = 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc';
    const url = resolveNativeExoStreamUrl(lockerEnvelope({ url: google }));
    expect(url).toContain('/api/proxy/stream?url=');
    expect(url).toContain('sb_client=');
  });

  it('passes youtube watch URLs through when server is configured but unreachable', () => {
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    const watch = 'https://www.youtube.com/watch?v=abc12345678';
    expect(wrapGoogleStreamForExo(watch)).toBe(watch);
  });

  it('pickMobileExoPlayUrl proxies googlevideo on Android when server is reachable', () => {
    const watch = 'https://www.youtube.com/watch?v=abc12345678';
    const google = 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc';
    const picked = pickMobileExoPlayUrl({
      uri: google,
      watchUrl: watch,
    });
    expect(picked).toContain('/api/proxy/stream');
    expect(picked).toContain(encodeURIComponent(google));
  });

  it('pickMobileExoPlayUrl prefers file:// from yt-dlp download over watch URL', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    const file = 'file:///data/user/0/rd.sheepskin.sandboxmusic/cache/ytdlp-playback/abc.m4a';
    const watch = 'https://www.youtube.com/watch?v=abc12345678';
    expect(
      pickMobileExoPlayUrl({
        uri: file,
        watchUrl: watch,
      }),
    ).toBe(file);
  });

  it('pickMobileExoPlayUrl streams googlevideo via local proxy when Sandbox Server is offline', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    const google = 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc';
    const watch = 'https://www.youtube.com/watch?v=abc12345678';
    const picked = pickMobileExoPlayUrl({
      uri: google,
      watchUrl: watch,
    });
    expect(picked).toBe(google);
    expect(picked).not.toBe(watch);
  });

  it('pickMobileExoPlayUrl does not swap googlevideo stream for watch URL on Android', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://192.168.1.10:3001');
    vi.mocked(isServerReachableCached).mockReturnValue(true);
    const google = 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc';
    const watch = 'https://www.youtube.com/watch?v=abc12345678';
    const picked = pickMobileExoPlayUrl({ uri: google, watchUrl: watch });
    expect(picked).toContain('/api/proxy/stream');
    expect(picked).not.toBe(watch);
  });

  it('isOfflineUnplayableStreamUrl flags googlevideo and tier34 proxy when server URL is empty', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('');
    expect(
      isOfflineUnplayableStreamUrl(
        'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      ),
    ).toBe(true);
    expect(
      isOfflineUnplayableStreamUrl('http://192.168.1.1:3001/api/proxy/stream?url=x'),
    ).toBe(true);
    expect(isOfflineUnplayableStreamUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
  });

  it('isOfflineUnplayableStreamUrl flags googlevideo when server URL exists but is unreachable', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://192.168.1.1:3001');
    vi.mocked(isServerReachableCached).mockReturnValue(false);
    expect(
      isOfflineUnplayableStreamUrl(
        'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      ),
    ).toBe(true);
    expect(
      isOfflineUnplayableStreamUrl('http://192.168.1.1:3001/api/proxy/stream?url=x'),
    ).toBe(true);
  });

  it('isOfflineUnplayableStreamUrl allows streams when server is reachable', () => {
    vi.mocked(getTier34BaseUrl).mockReturnValue('http://192.168.1.1:3001');
    vi.mocked(isServerReachableCached).mockReturnValue(true);
    expect(
      isOfflineUnplayableStreamUrl(
        'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      ),
    ).toBe(false);
  });

  it('passes through content URIs unchanged', () => {
    const content = 'content://rd.sheepskin.sandboxmusic.locker/track-abc';
    expect(resolveNativeExoStreamUrl(lockerEnvelope({ url: content }))).toBe(content);
  });
});

describe('resolveNativeExoStreamUrlAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlugin.getLockerBlobUri.mockResolvedValue({});
    mockPlugin.finishLockerBlob.mockResolvedValue({
      ok: true,
      contentUri: 'content://rd.sheepskin.sandboxmusic.locker/track-abc',
    });
  });

  it('prefers content:// for offline locker blobs on Android', async () => {
    const url = await resolveNativeExoStreamUrlAsync(lockerEnvelope());
    expect(url).toBe('content://rd.sheepskin.sandboxmusic.locker/track-abc');
    expect(mockPlugin.beginLockerBlob).toHaveBeenCalled();
  });

  it('reuses cached content URI when native reports one', async () => {
    mockPlugin.getLockerBlobUri.mockResolvedValue({
      contentUri: 'content://rd.sheepskin.sandboxmusic.locker/track-abc',
    });
    const url = await registerLockerBlobContentUri(lockerEnvelope());
    expect(url).toBe('content://rd.sheepskin.sandboxmusic.locker/track-abc');
    expect(mockPlugin.beginLockerBlob).not.toHaveBeenCalled();
  });
});

describe('lockerIdFromEnvelope', () => {
  it('prefers sourceId over envelopeId', () => {
    expect(lockerIdFromEnvelope(lockerEnvelope())).toBe('track-abc');
  });
});
