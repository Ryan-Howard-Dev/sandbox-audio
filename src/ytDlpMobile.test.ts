import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

const { resolveMock, getStatusMock, cancelMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  getStatusMock: vi.fn(),
  cancelMock: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core');
  return {
    ...actual,
    registerPlugin: vi.fn(() => ({
      resolve: resolveMock,
      getStatus: getStatusMock,
      cancel: cancelMock,
    })),
  };
});

import {
  isYtDlpMobileNativeAvailable,
  resolveViaYtDlpMobile,
  getYtDlpMobileStatus,
  getLastYtDlpMobileError,
  cancelYtDlpMobileResolve,
} from './ytDlpMobile';

describe('ytDlpMobile', () => {
  beforeEach(() => {
    resolveMock.mockReset();
    getStatusMock.mockReset();
    cancelMock.mockReset();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
  });

  it('is unavailable on web', async () => {
    expect(isYtDlpMobileNativeAvailable()).toBe(false);
    await expect(resolveViaYtDlpMobile('Artist Title')).resolves.toBeNull();
  });

  it('resolves on Android via native plugin', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    resolveMock.mockResolvedValue({
      uri: 'https://rr.example/audio.m4a',
      bitrate: 128,
      format: 'm4a',
    });

    await expect(resolveViaYtDlpMobile('Artist Title')).resolves.toEqual({
      uri: 'https://rr.example/audio.m4a',
      bitrate: 128,
      format: 'm4a',
    });
    expect(resolveMock).toHaveBeenCalledWith({ query: 'Artist Title' });
  });

  it('returns null when native resolve fails and records error', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    resolveMock.mockRejectedValue(new Error('no stream found'));

    await expect(resolveViaYtDlpMobile('missing track')).resolves.toBeNull();
    expect(getLastYtDlpMobileError()).toBe('no stream found');
  });

  it('retries once when native resolve reports no stream found', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    resolveMock
      .mockRejectedValueOnce(new Error('no stream found'))
      .mockResolvedValueOnce({
        uri: 'https://rr.example/retry.m4a',
        bitrate: 128,
        format: 'm4a',
      });

    await expect(resolveViaYtDlpMobile('Morgan Wallen Love Somebody')).resolves.toEqual({
      uri: 'https://rr.example/retry.m4a',
      bitrate: 128,
      format: 'm4a',
    });
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('cancels in-flight native resolve on demand', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    await cancelYtDlpMobileResolve();
    expect(cancelMock).toHaveBeenCalled();
  });

  it('reports native status on Android', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    getStatusMock.mockResolvedValue({
      available: true,
      initialized: true,
      version: '2025.01.01',
    });

    await expect(getYtDlpMobileStatus()).resolves.toEqual({
      available: true,
      initialized: true,
      version: '2025.01.01',
    });
  });
});
