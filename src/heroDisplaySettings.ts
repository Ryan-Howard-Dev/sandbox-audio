import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const HERO_DISPLAY_KEY = 'sandbox_hero_display';

export type HeroDisplayMode = 'album-cover' | 'vinyl-shades';

export function loadHeroDisplayMode(): HeroDisplayMode {
  const v = prefsGetItem(HERO_DISPLAY_KEY);
  return v === 'vinyl-shades' ? 'vinyl-shades' : 'album-cover';
}

export function saveHeroDisplayMode(mode: HeroDisplayMode): void {
  try {
    prefsSetItem(HERO_DISPLAY_KEY, mode);
  } catch {
    /* quota / private mode — still broadcast so UI updates this session */
  }
  window.dispatchEvent(
    new CustomEvent('sandbox-settings-change', { detail: { heroDisplayMode: mode } }),
  );
}

/** Flip album-cover ↔ vinyl-shades (mobile home quick toggle). */
export function toggleHeroDisplayMode(): HeroDisplayMode {
  const next: HeroDisplayMode =
    loadHeroDisplayMode() === 'vinyl-shades' ? 'album-cover' : 'vinyl-shades';
  saveHeroDisplayMode(next);
  return next;
}

/** Read hero display from a settings-change event when present. */
export function heroDisplayFromSettingsEvent(event: Event): HeroDisplayMode | null {
  const detail = (event as CustomEvent<{ heroDisplayMode?: HeroDisplayMode }>).detail;
  const mode = detail?.heroDisplayMode;
  return mode === 'vinyl-shades' || mode === 'album-cover' ? mode : null;
}

/**
 * Update hero display from a settings-change event.
 * Ignores bare broadcasts (playback, locker, vinyl sliders, etc.) so a vinyl
 * toggle is not immediately reverted by unrelated sandbox-settings-change noise.
 */
export function applyHeroDisplayFromSettingsEvent(
  event: Event,
  setMode: (mode: HeroDisplayMode) => void,
): void {
  const mode = heroDisplayFromSettingsEvent(event);
  if (mode != null) setMode(mode);
}

/** Album-cover vs vinyl-shades on hero surfaces (home, now playing, TV). */
export function resolveHeroShowShades(
  mode: HeroDisplayMode,
  hasArt: boolean,
  options?: { idleHome?: boolean },
): boolean {
  if (options?.idleHome) return true;
  return !hasArt || mode === 'vinyl-shades';
}
