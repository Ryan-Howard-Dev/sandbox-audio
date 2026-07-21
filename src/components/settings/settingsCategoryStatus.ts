import type { FidelityPolicy } from '../../sandboxSettings';
import type { DeviceCapacity } from '../../stations/theme';
import { formatCapacityLabel } from '../../lockerStorage';
import type { SettingsCategoryId } from './SettingsMobileRoot';

export type SettingsStatusSnapshot = {
  fidelity: FidelityPolicy;
  gapless: boolean;
  crossfade: boolean;
  capacity: DeviceCapacity;
  lockerTrackCount: number;
  lockerSyncEnabled: boolean;
  themeToneLabel: string;
  discoverEnabled: boolean;
  tier34Ok: boolean | null;
  networkSync: boolean;
  proAudio: boolean;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

function fidelityShortLabel(fidelity: FidelityPolicy, t: Translate): string {
  switch (fidelity) {
    case 'LOSSLESS':
      return t('settings.status.fidelityLossless');
    case 'HIGH':
      return t('settings.status.fidelityHigh');
    default:
      return t('settings.status.fidelityStandard');
  }
}

function capacityShortLabel(capacity: DeviceCapacity, t: Translate): string {
  const label = formatCapacityLabel(capacity);
  return label || t('settings.status.capacityCustom');
}

/** Live value shown on the right of a settings category row (Spotify / iOS style). */
export function settingsCategoryStatusValue(
  categoryId: SettingsCategoryId,
  snap: SettingsStatusSnapshot,
  t: Translate,
): string | undefined {
  switch (categoryId) {
    case 'fidelity':
      return fidelityShortLabel(snap.fidelity, t);
    case 'playback': {
      const parts: string[] = [];
      if (snap.gapless) parts.push(t('settings.status.gaplessOn'));
      if (snap.crossfade) parts.push(t('settings.status.crossfadeOn'));
      if (snap.proAudio) parts.push(t('settings.status.proAudioOn'));
      if (snap.networkSync) parts.push(t('settings.status.connectOn'));
      return parts.length > 0 ? parts.join(' · ') : t('settings.status.playbackDefault');
    }
    case 'vault': {
      if (snap.lockerSyncEnabled) return t('settings.status.syncOn');
      if (snap.lockerTrackCount > 0) {
        return t('settings.status.trackCount', { count: snap.lockerTrackCount });
      }
      return capacityShortLabel(snap.capacity, t);
    }
    case 'architect':
      return snap.themeToneLabel;
    case 'vinyl':
      return t('settings.status.vinylVisuals');
    case 'addons': {
      if (snap.tier34Ok === true) return t('settings.status.serverOnline');
      if (snap.tier34Ok === false) return t('settings.status.serverOffline');
      return snap.discoverEnabled ? t('settings.status.discoverOn') : undefined;
    }
    case 'telemetry':
      return t('settings.status.cacheStats');
    case 'diagnostics':
      if (snap.tier34Ok === true) return t('settings.status.serverOnline');
      if (snap.tier34Ok === false) return t('settings.status.serverOffline');
      return t('settings.status.healthCheck');
    case 'security':
      return t('settings.status.privacy');
    case 'about':
      return t('settings.status.help');
    default:
      return undefined;
  }
}
