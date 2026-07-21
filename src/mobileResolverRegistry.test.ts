import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMobileResolvers,
  registerMobileResolver,
  removeMobileResolver,
  setMobileResolverEnabled,
} from './mobileResolverRegistry';

describe('mobileResolverRegistry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds yt-dlp mobile resolver', () => {
    const resolvers = getMobileResolvers();
    const ytdlp = resolvers.find((r) => r.id === 'yt-dlp-mobile');
    expect(ytdlp).toBeDefined();
  });

  it('registers and returns custom resolvers', () => {
    registerMobileResolver({
      id: 'custom-1',
      name: 'Custom Resolver',
      enabled: true,
      resolve: async () => null,
    });
    expect(getMobileResolvers().some((r) => r.id === 'custom-1')).toBe(true);
  });

  it('persists enable/disable state', () => {
    registerMobileResolver({
      id: 'toggle-me',
      name: 'Toggle',
      enabled: false,
      resolve: async () => null,
    });
    setMobileResolverEnabled('toggle-me', true);
    expect(getMobileResolvers().find((r) => r.id === 'toggle-me')?.enabled).toBe(true);
    setMobileResolverEnabled('toggle-me', false);
    expect(getMobileResolvers().find((r) => r.id === 'toggle-me')?.enabled).toBe(false);
  });

  it('removes resolver from active list', () => {
    registerMobileResolver({
      id: 'remove-me',
      name: 'Remove',
      enabled: true,
      resolve: async () => null,
    });
    removeMobileResolver('remove-me');
    expect(getMobileResolvers().some((r) => r.id === 'remove-me')).toBe(false);
  });
});
