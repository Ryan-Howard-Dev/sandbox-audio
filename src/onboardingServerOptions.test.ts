import { describe, expect, it } from 'vitest';
import {
  defaultOnboardingServerMode,
  getOnboardingServerModeOptionOrder,
} from './onboardingServerOptions';

describe('onboarding server options', () => {
  it('defaults desktop to anchor and mobile to remote', () => {
    expect(defaultOnboardingServerMode(true)).toBe('anchor');
    expect(defaultOnboardingServerMode(false)).toBe('remote');
  });

  it('lists anchor first on desktop', () => {
    expect(
      getOnboardingServerModeOptionOrder({ isTauriDesktop: true, canHostAnchor: true }),
    ).toEqual(['anchor', 'remote', 'off']);
  });

  it('hides anchor on mobile and puts remote first', () => {
    expect(
      getOnboardingServerModeOptionOrder({ isTauriDesktop: false, canHostAnchor: false }),
    ).toEqual(['remote', 'off']);
  });
});
