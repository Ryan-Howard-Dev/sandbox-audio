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
  /** Optional until SettingsView wires station snapshot fields. */
  podcastsEnabled?: boolean;
  audiobooksEnabled?: boolean;
  podcastSeekInterval?: number;
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
    // --- Station IA (target) ---
    case 'music': {
      const parts: string[] = [fidelityShortLabel(snap.fidelity, t)];
      if (snap.gapless) parts.push(t('settings.status.gaplessOn'));
      if (snap.crossfade) parts.push(t('settings.status.crossfadeOn'));
      if (snap.proAudio) parts.push(t('settings.status.proAudioOn'));
      return parts.join(' · ');
    }
    case 'podcasts': {
      if (!snap.podcastsEnabled) return t('settings.status.stationOff');
      return t('settings.status.podcastSeek', {
        seconds: snap.podcastSeekInterval ?? 30,
      });
    }
    case 'audiobooks':
      return snap.audiobooksEnabled
        ? t('settings.status.stationOn')
        : t('settings.status.stationOff');
    case 'documents':
      return t('settings.status.documentsLink');
    case 'everything': {
      const parts: string[] = [];
      if (snap.lockerSyncEnabled) parts.push(t('settings.status.syncOn'));
      else parts.push(capacityShortLabel(snap.capacity, t));
      if (snap.tier34Ok === true) parts.push(t('settings.status.serverOnline'));
      else if (snap.tier34Ok === false) parts.push(t('settings.status.serverOffline'));
      if (snap.networkSync) parts.push(t('settings.status.connectOn'));
      return parts.join(' · ');
    }

    // --- Legacy subsystem tabs (until SettingsView migrates) ---
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
