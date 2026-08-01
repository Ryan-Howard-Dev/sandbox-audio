import type { SettingsCategoryId, SettingsStationCategoryId } from './SettingsMobileRoot';

/** Legacy tab ids still passed by sandboxLayer3 openSettings / initialTab. */
export type LegacySettingsTab =
  | 'fidelity'
  | 'playback'
  | 'vault'
  | 'architect'
  | 'vinyl'
  | 'addons'
  | 'telemetry'
  | 'diagnostics'
  | 'security'
  | 'about';

export type SettingsTab = SettingsCategoryId;

/** Map legacy subsystem tabs onto station categories (used as panels migrate). */
export function normalizeSettingsTab(
  tab: SettingsTab | LegacySettingsTab | undefined | null,
): SettingsStationCategoryId {
  if (!tab) return 'music';
  switch (tab) {
    case 'music':
    case 'podcasts':
    case 'audiobooks':
    case 'documents':
    case 'everything':
      return tab;
    case 'fidelity':
    case 'playback':
    case 'vinyl':
      return 'music';
    case 'vault':
    case 'architect':
    case 'addons':
    case 'telemetry':
    case 'diagnostics':
    case 'security':
    case 'about':
      return 'everything';
    default:
      return 'music';
  }
}
