import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnqueue, mockPlayUrl } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(async () => ({ ok: true })),
  mockPlayUrl: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'android'),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({
    enqueueNext: mockEnqueue,
    playUrl: mockPlayUrl,
    getStatus: vi.fn(async () => ({ available: true, wired: true, message: 'ok' })),
  })),
}));

vi.mock('./backgroundMedia', () => ({
  resolveAndroidForegroundArtworkUrl: vi.fn(async (url?: string) =>
    url?.startsWith('blob:') ? 'data:image/jpeg;base64,abc' : url,
  ),
  nextAndroidMediaMetadataRevision: vi.fn(() => Date.now()),
}));

vi.mock('./androidNativePlaybackSettings', () => ({
  loadAndroidNativePlaybackEnabled: vi.fn(() => true),
  loadAndroidWebViewCrossfadeEnabled: vi.fn(() => false),
}));

vi.mock('./tier34/client', () => ({
  appendSandboxClientQuery: vi.fn((url: string) => `${url}?sb_client=test`),
}));

import { nativeExoEnqueueNext, nativeExoPlayUrl } from './androidNativePlayback';

describe('nativeExoEnqueueNext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends sb_client to tier34 API URLs', async () => {
    await nativeExoEnqueueNext('http://192.168.1.10:3001/api/cast/stream/abc');
    expect(mockEnqueue).toHaveBeenCalledWith({
      url: 'http://192.168.1.10:3001/api/cast/stream/abc?sb_client=test',
    });
  });

  it('passes content URIs unchanged', async () => {
    const uri = 'content://rd.sheepskin.sandboxmusic.locker/track-1';
    await nativeExoEnqueueNext(uri);
    expect(mockEnqueue).toHaveBeenCalledWith({ url: uri });
  });

  it('converts blob artwork to data URL before enqueueNext', async () => {
    const uri = 'content://rd.sheepskin.sandboxmusic.locker/track-2';
    await nativeExoEnqueueNext(uri, {
      title: 'Track',
      artworkUrl: 'blob:https://localhost/art',
    });
    expect(mockEnqueue).toHaveBeenCalledWith({
      url: uri,
      title: 'Track',
      artworkUrl: 'data:image/jpeg;base64,abc',
    });
  });
});

describe('nativeExoPlayUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts blob artwork to data URL before playUrl', async () => {
    const uri = 'content://rd.sheepskin.sandboxmusic.locker/track-3';
    await nativeExoPlayUrl(uri, {
      autoPlay: false,
      title: 'Redrum',
      artworkUrl: 'blob:https://localhost/cover',
    });
    expect(mockPlayUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: uri,
        artworkUrl: 'data:image/jpeg;base64,abc',
        title: 'Redrum',
      }),
    );
  });
});
