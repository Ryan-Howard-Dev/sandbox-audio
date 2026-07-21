import { describe, expect, it } from 'vitest';
import { getOnboardingStepIds } from './onboardingSteps';

describe('getOnboardingStepIds', () => {
  it('starts desktop onboarding with welcome before locker', () => {
    expect(
      getOnboardingStepIds({ isTauriDesktop: true, lockerPlatform: 'tauri' }),
    ).toEqual(['welcome', 'locker', 'server', 'cast', 'identity']);
  });

  it('skips locker on mobile (IndexedDB — no folder to choose)', () => {
    expect(
      getOnboardingStepIds({ isTauriDesktop: false, lockerPlatform: 'android' }),
    ).toEqual(['welcome', 'name', 'taste', 'playback', 'finish']);
    expect(
      getOnboardingStepIds({ isTauriDesktop: false, lockerPlatform: 'ios' }),
    ).toEqual(['welcome', 'name', 'taste', 'server', 'finish']);
  });

  it('skips locker on web but keeps welcome first', () => {
    expect(
      getOnboardingStepIds({ isTauriDesktop: false, lockerPlatform: 'web' }),
    ).toEqual(['welcome', 'name', 'taste', 'server', 'finish']);
  });
});
