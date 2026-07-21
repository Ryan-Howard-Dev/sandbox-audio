import { describe, expect, it } from 'vitest';
import {
  settingsCategoryStatusValue,
  type SettingsStatusSnapshot,
} from './settingsCategoryStatus';

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === 'settings.status.trackCount' && params?.count != null) {
    return `${params.count} tracks`;
  }
  const labels: Record<string, string> = {
    'settings.status.fidelityLossless': 'Lossless',
    'settings.status.fidelityHigh': 'High',
    'settings.status.fidelityStandard': 'Standard',
    'settings.status.gaplessOn': 'Gapless on',
    'settings.status.crossfadeOn': 'Crossfade on',
    'settings.status.playbackDefault': 'Default',
    'settings.status.syncOn': 'Sync on',
    'settings.status.serverOnline': 'Online',
    'settings.status.serverOffline': 'Offline',
    'settings.status.privacy': 'Privacy',
  };
  return labels[key] ?? key;
};

const baseSnap: SettingsStatusSnapshot = {
  fidelity: 'STANDARD',
  gapless: false,
  crossfade: false,
  capacity: '100 GB',
  lockerTrackCount: 0,
  lockerSyncEnabled: false,
  themeToneLabel: 'Warm dusk',
  discoverEnabled: false,
  tier34Ok: null,
  networkSync: false,
  proAudio: false,
};

describe('settingsCategoryStatusValue', () => {
  it('returns fidelity label', () => {
    expect(
      settingsCategoryStatusValue('fidelity', { ...baseSnap, fidelity: 'LOSSLESS' }, t),
    ).toBe('Lossless');
  });

  it('combines playback flags', () => {
    expect(
      settingsCategoryStatusValue(
        'playback',
        { ...baseSnap, gapless: true, crossfade: true },
        t,
      ),
    ).toBe('Gapless on · Crossfade on');
  });

  it('prefers sync status for vault', () => {
    expect(
      settingsCategoryStatusValue('vault', { ...baseSnap, lockerSyncEnabled: true }, t),
    ).toBe('Sync on');
  });

  it('shows track count when locker has tracks', () => {
    expect(
      settingsCategoryStatusValue('vault', { ...baseSnap, lockerTrackCount: 42 }, t),
    ).toBe('42 tracks');
  });

  it('shows server online for diagnostics', () => {
    expect(
      settingsCategoryStatusValue('diagnostics', { ...baseSnap, tier34Ok: true }, t),
    ).toBe('Online');
  });
});
