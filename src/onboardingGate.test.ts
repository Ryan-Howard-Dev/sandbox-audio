import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platformEnv', () => ({
  isTauri: vi.fn(() => false),
  isCapacitorNative: vi.fn(() => false),
}));

vi.mock('./hooks/mobileShellLayout', () => ({
  isNativeCapacitorNonTv: vi.fn(() => false),
  usesMobileShellLayout: vi.fn(() => false),
}));

vi.mock('./firstRunStorage', () => ({
  firstRunGetItem: vi.fn(() => null),
  firstRunSetItem: vi.fn(),
  firstRunRemoveItem: vi.fn(),
}));

import { firstRunGetItem } from './firstRunStorage';
import { isCapacitorNative, isTauri } from './platformEnv';
import { isNativeCapacitorNonTv, usesMobileShellLayout } from './hooks/mobileShellLayout';
import { shouldShowOnboardingWizard } from './sandboxSettings';

describe('shouldShowOnboardingWizard', () => {
  beforeEach(() => {
    vi.mocked(firstRunGetItem).mockReturnValue(null);
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isCapacitorNative).mockReturnValue(false);
    vi.mocked(isNativeCapacitorNonTv).mockReturnValue(false);
    vi.mocked(usesMobileShellLayout).mockReturnValue(false);
  });

  it('returns false when onboarding already complete', () => {
    vi.mocked(firstRunGetItem).mockReturnValue('true');
    vi.mocked(isNativeCapacitorNonTv).mockReturnValue(true);
    expect(shouldShowOnboardingWizard()).toBe(false);
  });

  it('shows on native phone (mobile shell)', () => {
    vi.mocked(isNativeCapacitorNonTv).mockReturnValue(true);
    expect(shouldShowOnboardingWizard()).toBe(true);
  });

  it('shows on native tablet even when desktop shell layout is used', () => {
    vi.mocked(isNativeCapacitorNonTv).mockReturnValue(true);
    vi.mocked(usesMobileShellLayout).mockReturnValue(false);
    expect(shouldShowOnboardingWizard()).toBe(true);
  });

  it('does not show on wide web PWA when not native', () => {
    vi.mocked(usesMobileShellLayout).mockReturnValue(false);
    expect(shouldShowOnboardingWizard()).toBe(false);
  });

  it('shows on narrow web PWA', () => {
    vi.mocked(usesMobileShellLayout).mockReturnValue(true);
    expect(shouldShowOnboardingWizard()).toBe(true);
  });

  it('shows on Tauri desktop first launch', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(shouldShowOnboardingWizard()).toBe(true);
  });
});
