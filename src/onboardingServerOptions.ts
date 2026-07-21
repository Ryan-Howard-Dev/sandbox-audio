import type { SandboxServerMode } from './sandboxSettings';

export type OnboardingServerModeOption = SandboxServerMode;

/** Order and visibility for onboarding server step — anchor first on desktop, remote first on mobile. */
export function getOnboardingServerModeOptionOrder(opts: {
  isTauriDesktop: boolean;
  canHostAnchor: boolean;
}): OnboardingServerModeOption[] {
  if (opts.isTauriDesktop && opts.canHostAnchor) {
    return ['anchor', 'remote', 'off'];
  }
  return ['remote', 'off'];
}

export function defaultOnboardingServerMode(isTauriDesktop: boolean): SandboxServerMode {
  return isTauriDesktop ? 'anchor' : 'remote';
}
