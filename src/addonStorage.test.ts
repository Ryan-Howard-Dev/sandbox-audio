import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_ADDON_IDS,
  getAddonStatus,
  loadAddons,
  type SandboxAddon,
} from './addonStorage';

vi.mock('./sandboxSettings', () => ({
  loadShowExperimentalIntegrations: vi.fn(() => false),
}));

function stubAddon(enabled: boolean): SandboxAddon {
  return {
    id: BUILTIN_ADDON_IDS.soundcloud,
    name: 'SoundCloud',
    version: '0.2.0',
    tier: 2,
    manifestUrl: '',
    builtIn: true,
    enabled,
  };
}

describe('getAddonStatus', () => {
  it('returns DISABLED when addon is not enabled', () => {
    expect(getAddonStatus(stubAddon(false))).toBe('DISABLED');
  });

  it('returns STUBBED for enabled built-in dev-test addons', () => {
    expect(getAddonStatus(stubAddon(true))).toBe('STUBBED');
  });

  it('returns ACTIVE for enabled user manifest addons', () => {
    const userAddon: SandboxAddon = {
      id: 'user-custom-addon',
      name: 'Custom',
      version: '1.0.0',
      tier: 2,
      manifestUrl: 'https://example.com/addon.json',
      builtIn: false,
      enabled: true,
    };
    expect(getAddonStatus(userAddon)).toBe('ACTIVE');
  });

  it('loads built-in stub addons from storage', () => {
    const builtins = loadAddons().filter((a) => a.builtIn);
    expect(builtins.some((a) => a.id === BUILTIN_ADDON_IDS.audius)).toBe(true);
    expect(builtins.some((a) => a.id === BUILTIN_ADDON_IDS.soulseek)).toBe(true);
  });
});
