import { describe, expect, it, vi } from 'vitest';
import {
  isPlayerHomeUrl,
  registerOpenHomePlayerHandler,
  PLAYER_HOME_URL,
} from './playerDeepLink';

describe('playerDeepLink', () => {
  it('recognizes player home URLs', () => {
    expect(isPlayerHomeUrl(PLAYER_HOME_URL)).toBe(true);
    expect(isPlayerHomeUrl('sandboxmusic://player/home')).toBe(true);
    expect(isPlayerHomeUrl('sandboxmusic://e2e/skip-onboarding')).toBe(false);
  });

  it('registers and invokes open home handler', () => {
    const fn = vi.fn();
    registerOpenHomePlayerHandler(fn);
    expect(isPlayerHomeUrl(PLAYER_HOME_URL)).toBe(true);
    registerOpenHomePlayerHandler(null);
  });
});
