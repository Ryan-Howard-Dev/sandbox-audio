import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

vi.mock('./platformEnv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platformEnv')>();
  return {
    ...actual,
    getPlatformDiagnostics: vi.fn(),
  };
});

vi.mock('./tvDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tvDetection')>();
  return {
    ...actual,
    detectTVPlatform: vi.fn(),
  };
});

import {
  isLeanbackTvShell,
  mergeRemoteSecretDecisions,
  shouldApplyRemoteSecret,
  type DeviceSecretEntry,
  type SecretMetaStore,
} from './deviceSecretSync';
import { getPlatformDiagnostics } from './platformEnv';
import { detectTVPlatform } from './tvDetection';

describe('shouldApplyRemoteSecret', () => {
  const remote: DeviceSecretEntry = { value: 'remote-key', updatedAt: 1000 };

  it('applies remote when local value is empty', () => {
    expect(shouldApplyRemoteSecret(undefined, '', remote)).toBe(true);
  });

  it('keeps newer local over older remote', () => {
    const localMeta = { updatedAt: 2000 };
    expect(shouldApplyRemoteSecret(localMeta, 'local-key', remote)).toBe(false);
  });

  it('applies remote when remote is newer than local', () => {
    const localMeta = { updatedAt: 500 };
    expect(shouldApplyRemoteSecret(localMeta, 'local-key', remote)).toBe(true);
  });

  it('respects localOnly flag', () => {
    const localMeta = { updatedAt: 0, localOnly: true };
    expect(shouldApplyRemoteSecret(localMeta, '', remote)).toBe(false);
    expect(shouldApplyRemoteSecret(localMeta, 'local-key', remote)).toBe(false);
  });
});

describe('mergeRemoteSecretDecisions', () => {
  it('merges only newer remote keys and skips localOnly', () => {
    const remote: Record<string, DeviceSecretEntry> = {
      sandbox_realdebrid_api_key: { value: 'rd-remote', updatedAt: 3000 },
      sandbox_prowlarr_api_key: { value: 'prowlarr-remote', updatedAt: 500 },
      sandbox_lastfm_api_key: { value: 'lastfm-remote', updatedAt: 4000 },
    };
    const localValues = {
      sandbox_realdebrid_api_key: 'rd-local',
      sandbox_prowlarr_api_key: 'prowlarr-local',
      sandbox_lastfm_api_key: '',
    };
    const localMeta: SecretMetaStore = {
      sandbox_realdebrid_api_key: { updatedAt: 2000 },
      sandbox_prowlarr_api_key: { updatedAt: 2000 },
      sandbox_lastfm_api_key: { updatedAt: 0, localOnly: true },
    };

    expect(mergeRemoteSecretDecisions(remote, localValues, localMeta)).toEqual({
      sandbox_realdebrid_api_key: 'rd-remote',
    });
  });

  it('fills empty local slots from remote regardless of timestamps', () => {
    const remote = {
      sandbox_listenbrainz_token: { value: 'lb-token', updatedAt: 100 },
    };
    expect(mergeRemoteSecretDecisions(remote, {}, {})).toEqual({
      sandbox_listenbrainz_token: 'lb-token',
    });
  });
});

describe('TV leanback shell — secrets merge', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.mocked(getPlatformDiagnostics).mockReturnValue({
      platform: 'web',
      label: 'Web / PWA',
      isTauri: false,
      isCapacitorNative: false,
      isAndroid: false,
      isWeb: true,
      isAndroidTv: false,
      isLinux: false,
      isDesktopLinux: false,
      desktopOs: null,
      capacitorPlatform: null,
    });
    vi.mocked(detectTVPlatform).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('mergeRemoteSecretDecisions is not gated by TV platform', () => {
    const remote: Record<string, DeviceSecretEntry> = {
      sandbox_realdebrid_api_key: { value: 'rd-from-windows', updatedAt: 5000 },
      sandbox_prowlarr_api_key: { value: 'prowlarr-from-windows', updatedAt: 5000 },
    };
    expect(mergeRemoteSecretDecisions(remote, {}, {})).toEqual({
      sandbox_realdebrid_api_key: 'rd-from-windows',
      sandbox_prowlarr_api_key: 'prowlarr-from-windows',
    });
  });

  it('isLeanbackTvShell detects android-tv diagnostics', () => {
    vi.mocked(getPlatformDiagnostics).mockReturnValue({
      platform: 'android-tv',
      label: 'Android TV',
      isTauri: false,
      isCapacitorNative: true,
      isAndroid: true,
      isWeb: false,
      isAndroidTv: true,
      isLinux: false,
      isDesktopLinux: false,
      desktopOs: null,
      capacitorPlatform: 'android',
    });
    vi.mocked(detectTVPlatform).mockReturnValue(false);
    expect(isLeanbackTvShell()).toBe(true);
  });

  it('isLeanbackTvShell detects detectTVPlatform leanback shells', () => {
    vi.mocked(detectTVPlatform).mockReturnValue(true);
    expect(isLeanbackTvShell()).toBe(true);
  });
});
