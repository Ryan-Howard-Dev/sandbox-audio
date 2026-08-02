/**
 * Which launcher icon the app wears.
 *
 * Android has no API for setting an app icon. The only mechanism is one activity-alias per icon in
 * the manifest with exactly one enabled, which AppIconPlugin does. Everything here is the shape of
 * that: a short fixed list, because each entry is a manifest declaration and a set of drawables
 * that had to exist at install time.
 *
 * Android only. On desktop and web the icon belongs to the installer and the browser, so this
 * reports unavailable rather than pretending to offer a choice it cannot make.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export type AppIconKey = 'default' | 'bloodorange' | 'graphite' | 'terminal';

interface AppIconPlugin {
  getIcons(): Promise<{ icons: string[]; active: string }>;
  setIcon(options: { key: string }): Promise<{ active: string }>;
}

const AppIcon = registerPlugin<AppIconPlugin>('AppIcon');

export interface AppIconOption {
  key: AppIconKey;
  /** i18n key for the name shown beside the swatch. */
  labelKey: string;
  /** Swatch colours, so the picker can draw each icon without shipping four more bitmaps. */
  background: string;
  foreground: string;
}

/**
 * The icons that exist, in the order they are offered.
 *
 * Named after the skins they match rather than invented separately, so someone running Terminal
 * can have a launcher icon that does not clash with the app they are about to open. The colours
 * below are the same hexes as themePresets.ts, and the drawables under
 * android/app/src/main/res/drawable/ic_launcher_*.xml use them too.
 */
export const APP_ICONS: AppIconOption[] = [
  {
    key: 'default',
    labelKey: 'settings.appearance.iconDefault',
    background: '#07080C',
    foreground: '#C2410C',
  },
  {
    key: 'bloodorange',
    labelKey: 'settings.appearance.iconBloodOrange',
    background: '#12040A',
    foreground: '#FF4A1C',
  },
  {
    key: 'graphite',
    labelKey: 'settings.appearance.iconGraphite',
    background: '#1B1D21',
    foreground: '#FB923C',
  },
  {
    key: 'terminal',
    labelKey: 'settings.appearance.iconTerminal',
    background: '#000000',
    foreground: '#FFB000',
  },
];

export function isAppIconSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function isAppIconKey(value: string): value is AppIconKey {
  return APP_ICONS.some((icon) => icon.key === value);
}

/**
 * The icon currently enabled.
 *
 * Read from the package manager rather than from a stored preference, because the two can disagree:
 * a reinstall resets component state while a preference survives it, and the launcher shows the
 * truth rather than what was last chosen.
 */
export async function getActiveAppIcon(): Promise<AppIconKey> {
  if (!isAppIconSupported()) return 'default';
  try {
    const { active } = await AppIcon.getIcons();
    return isAppIconKey(active) ? active : 'default';
  } catch {
    return 'default';
  }
}

export type AppIconChangeFailure = 'unsupported' | 'failed';

/**
 * Change the icon.
 *
 * Expect the app to be killed. Android restarts a package whose component enablement changed, and
 * DONT_KILL_APP is a request the system routinely ignores. The caller warns first; treating the
 * restart as an error would be describing the platform as broken.
 */
export async function setAppIcon(
  key: AppIconKey,
): Promise<{ ok: boolean; reason?: AppIconChangeFailure }> {
  if (!isAppIconSupported()) return { ok: false, reason: 'unsupported' };
  try {
    await AppIcon.setIcon({ key });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
