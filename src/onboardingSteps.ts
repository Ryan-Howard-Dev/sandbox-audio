import type { LockerRootPlatform } from './lockerRootBridge';

export type OnboardingStepId =
  | 'welcome'
  | 'name'
  | 'taste'
  | 'locker'
  | 'server'
  | 'playback'
  | 'cast'
  | 'identity'
  | 'finish';

export function getOnboardingStepIds(opts: {
  isTauriDesktop: boolean;
  lockerPlatform: LockerRootPlatform;
}): OnboardingStepId[] {
  if (opts.isTauriDesktop) {
    return ['welcome', 'locker', 'server', 'cast', 'identity'];
  }
  // Mobile Android: server setup screen after profile; playback test before finish.
  if (opts.lockerPlatform === 'android') {
    return ['welcome', 'name', 'taste', 'playback', 'finish'];
  }
  return ['welcome', 'name', 'taste', 'server', 'finish'];
}
