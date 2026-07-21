import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platformEnv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platformEnv')>();
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    isCapacitorNative: vi.fn(() => false),
  };
});

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      getPlatform: vi.fn(() => 'web'),
      isNativePlatform: vi.fn(() => false),
    },
  };
});

import { Capacitor } from '@capacitor/core';
import { isCapacitorNative, isTauri } from './platformEnv';
import {
  getLockerRootPlatform,
  pickLockerRootFolder,
  supportsLockerFolderPicker,
  usesAutomaticLockerStorage,
} from './lockerRootBridge';

describe('lockerRootBridge platform helpers', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isCapacitorNative).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('detects tauri as folder-picker platform', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(getLockerRootPlatform()).toBe('tauri');
    expect(supportsLockerFolderPicker()).toBe(true);
    expect(usesAutomaticLockerStorage()).toBe(false);
  });

  it('detects android as automatic app storage', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    expect(getLockerRootPlatform()).toBe('android');
    expect(supportsLockerFolderPicker()).toBe(false);
    expect(usesAutomaticLockerStorage()).toBe(true);
  });

  it('detects ios as automatic app storage', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(getLockerRootPlatform()).toBe('ios');
    expect(supportsLockerFolderPicker()).toBe(false);
    expect(usesAutomaticLockerStorage()).toBe(true);
  });

  it('returns null from pickLockerRootFolder on non-tauri', async () => {
    expect(await pickLockerRootFolder()).toBeNull();
  });
});
