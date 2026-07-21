import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platformEnv', () => ({
  isTauri: vi.fn(() => false),
  isCapacitorNative: vi.fn(() => false),
}));

vi.mock('../tvDetection', () => ({
  detectTVPlatform: vi.fn(() => false),
  isAndroidTabletNative: vi.fn(() => false),
}));

import { isCapacitorNative, isTauri } from '../platformEnv';
import {
  MOBILE_SHELL_MAX_WIDTH_PX,
  TABLET_MIN_SMALLEST_WIDTH_DP,
  isDevMobilePreview,
  isNativeMobileShellClient,
  isTabletViewport,
  usesMobileShellLayout,
} from './mobileShellLayout';

function stubWindow(options: {
  matchMediaMatches?: boolean;
  search?: string;
  innerWidth?: number;
  innerHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
} = {}) {
  const {
    matchMediaMatches = false,
    search = '',
    innerWidth = 1280,
    innerHeight = 800,
    screenWidth = innerWidth,
    screenHeight = innerHeight,
  } = options;
  vi.stubGlobal('window', {
    innerWidth,
    innerHeight,
    screen: { width: screenWidth, height: screenHeight },
    matchMedia: vi.fn().mockImplementation(() => ({
      matches: matchMediaMatches,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    history: { replaceState: vi.fn() },
    location: { search },
  } as unknown as Window & typeof globalThis);
}

describe('mobileShellLayout', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isCapacitorNative).mockReturnValue(false);
    vi.unstubAllGlobals();
    stubWindow({ matchMediaMatches: false });
  });

  it('exports 767px breakpoint aligned with Tailwind md', () => {
    expect(MOBILE_SHELL_MAX_WIDTH_PX).toBe(767);
  });

  it('uses mobile shell on native Capacitor phone', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    stubWindow({ innerWidth: 412, innerHeight: 915 });
    expect(isNativeMobileShellClient()).toBe(true);
    expect(usesMobileShellLayout()).toBe(true);
  });

  it('uses bottom-nav shell on native Capacitor tablet portrait (sw600dp)', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    stubWindow({
      innerWidth: 600,
      innerHeight: 1024,
    });
    expect(isTabletViewport()).toBe(true);
    expect(isNativeMobileShellClient()).toBe(false);
    expect(usesMobileShellLayout()).toBe(true);
  });

  it('uses desktop shell on native Capacitor tablet landscape', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    stubWindow({
      innerWidth: 1024,
      innerHeight: 600,
    });
    expect(isTabletViewport()).toBe(true);
    expect(isNativeMobileShellClient()).toBe(false);
    expect(usesMobileShellLayout()).toBe(false);
  });

  it('keeps phone shell in native landscape when smallest width stays phone-sized', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    stubWindow({ innerWidth: 915, innerHeight: 412 });
    expect(isTabletViewport()).toBe(false);
    expect(usesMobileShellLayout()).toBe(true);
  });

  it('detects tablet via smallest width threshold', () => {
    stubWindow({
      innerWidth: TABLET_MIN_SMALLEST_WIDTH_DP,
      innerHeight: 900,
    });
    expect(isTabletViewport()).toBe(true);
  });

  it('detects native tablet via screen fallback when innerWidth is still zero', () => {
    vi.mocked(isCapacitorNative).mockReturnValue(true);
    stubWindow({ innerWidth: 0, innerHeight: 0, screenWidth: 600, screenHeight: 1024 });
    expect(isTabletViewport()).toBe(true);
    // 0×0 falls back to portrait → bottom nav
    expect(usesMobileShellLayout()).toBe(true);
  });

  it('uses mobile shell on narrow PWA viewport', () => {
    stubWindow({ matchMediaMatches: true, innerWidth: 390, innerHeight: 844 });
    expect(usesMobileShellLayout()).toBe(true);
  });

  it('uses desktop shell on wide PWA viewport', () => {
    stubWindow({ matchMediaMatches: false });
    expect(usesMobileShellLayout()).toBe(false);
  });

  it('never uses mobile shell on Tauri even when narrow', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    stubWindow({ matchMediaMatches: true });
    expect(usesMobileShellLayout()).toBe(false);
  });

  it('isDevMobilePreview reads ?mobile=1 in dev', () => {
    vi.stubEnv('DEV', true);
    stubWindow({ search: '?mobile=1' });
    expect(isDevMobilePreview()).toBe(true);
    vi.unstubAllEnvs();
  });
});
