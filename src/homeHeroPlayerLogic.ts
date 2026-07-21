import type { HeroDisplayMode } from './heroDisplaySettings';

const PLACEHOLDER_ARTIST_RE = /^(local[\s-]?upload|localupload)$/i;

/** Square album poster vs spinning vinyl disc. */
export function shouldShowAlbumPoster(
  mode: HeroDisplayMode,
  hasArt: boolean,
  idle: boolean,
  options?: { forceVinyl?: boolean },
): boolean {
  if (options?.forceVinyl) return false;
  return mode === 'album-cover' && hasArt && !idle;
}

export type HeroVisualProbe = {
  visual: 'poster' | 'vinyl' | 'none';
  expanded: boolean;
  settingsOpen: boolean;
  hasArt: boolean;
};

export type MobileVinylSettingsProbe = {
  open: boolean;
  hasDmtPreset: boolean;
  hasTripPreset: boolean;
  hasGlowPreset: boolean;
  hasSubtlePreset: boolean;
  presetIds: string[];
  sliderKeys: string[];
  themeCount: number;
};

/** Automation probe — mobile sheet must not expose Trip/DMT desktop presets. */
export function probeMobileVinylSettingsSheet(): MobileVinylSettingsProbe {
  if (typeof document === 'undefined') {
    return {
      open: false,
      hasDmtPreset: false,
      hasTripPreset: false,
      hasGlowPreset: false,
      hasSubtlePreset: false,
      presetIds: [],
      sliderKeys: [],
      themeCount: 0,
    };
  }
  const sheet = document.querySelector('[data-testid="mobile-home-vinyl-settings-sheet"]');
  if (!sheet) {
    return {
      open: false,
      hasDmtPreset: false,
      hasTripPreset: false,
      hasGlowPreset: false,
      hasSubtlePreset: false,
      presetIds: [],
      sliderKeys: [],
      themeCount: 0,
    };
  }
  const presetIds = Array.from(
    sheet.querySelectorAll<HTMLElement>('[data-testid^="mobile-vinyl-preset-"]'),
  )
    .map((el) => el.dataset.testid?.replace('mobile-vinyl-preset-', '') ?? '')
    .filter(Boolean);
  const sliderKeys = Array.from(
    sheet.querySelectorAll<HTMLElement>('[data-testid^="mobile-vinyl-slider-"]'),
  )
    .map((el) => el.dataset.testid?.replace('mobile-vinyl-slider-', '') ?? '')
    .filter(Boolean);
  const themeCount = sheet.querySelectorAll('[data-testid^="mobile-vinyl-theme-"]').length;
  return {
    open: true,
    hasDmtPreset: presetIds.includes('dmt'),
    hasTripPreset: presetIds.includes('trip'),
    hasGlowPreset: presetIds.includes('glow'),
    hasSubtlePreset: presetIds.includes('subtle'),
    presetIds,
    sliderKeys,
    themeCount,
  };
}

/** Tap the home hero vinyl/album toggle (sliders button) — returns false if not on screen. */
export function clickHomeVinylToggleButton(): boolean {
  if (typeof document === 'undefined') return false;
  const btn = document.querySelector('[data-testid="home-vinyl-settings-btn"]');
  if (!(btn instanceof HTMLElement)) return false;
  btn.click();
  return true;
}

/** Automation probe — compact mini bar on non-home stations (should be a thin strip, not ~25% viewport). */
export function probeMiniPlayerBar(): {
  present: boolean;
  compact: boolean;
  heightPx: number;
  viewportRatio: number;
  onNonHomeStation: boolean;
} {
  if (typeof document === 'undefined') {
    return { present: false, compact: false, heightPx: 0, viewportRatio: 0, onNonHomeStation: false };
  }
  const bar = document.querySelector('[data-testid="player-bar"]');
  const onNonHomeStation = Boolean(
    document.querySelector('.mobile-player-dock [data-testid="player-bar"]'),
  );
  if (!(bar instanceof HTMLElement)) {
    return { present: false, compact: false, heightPx: 0, viewportRatio: 0, onNonHomeStation };
  }
  const rect = bar.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  return {
    present: true,
    compact: bar.classList.contains('player-bar--mobile-mini'),
    heightPx: Math.round(rect.height),
    viewportRatio: rect.height / vh,
    onNonHomeStation,
  };
}

/** Combined dock / mini bar probe for mobile home lifecycle tests. */
export function probeMobileHomeChrome(): {
  homeCompact: boolean;
  hasVinylDisc: boolean;
  hasPoster: boolean;
  vinylDiscPx: number;
  posterPx: number;
  heroVisualPx: number;
  heroVisualKind: 'vinyl' | 'poster' | 'none';
  hasHeroTitle: boolean;
  combinedDock: boolean;
  miniPlayerVisible: boolean;
  nowPlayingOpen: boolean;
  shellNowPlayingClass: boolean;
} {
  if (typeof document === 'undefined') {
    return {
      homeCompact: false,
      hasVinylDisc: false,
      hasPoster: false,
      vinylDiscPx: 0,
      posterPx: 0,
      heroVisualPx: 0,
      heroVisualKind: 'none',
      hasHeroTitle: false,
      combinedDock: false,
      miniPlayerVisible: false,
      nowPlayingOpen: false,
      shellNowPlayingClass: false,
    };
  }
  const disc = document.querySelector('.home-vinyl-disc.vinyl-disc');
  const posterWrap = document.querySelector('.home-hero-poster-wrap');
  const discRect = disc?.getBoundingClientRect();
  const posterRect = posterWrap?.getBoundingClientRect();
  const vinylDiscPx = discRect ? Math.round(Math.min(discRect.width, discRect.height)) : 0;
  const posterPx = posterRect ? Math.round(Math.min(posterRect.width, posterRect.height)) : 0;
  const heroVisualPx = Math.max(vinylDiscPx, posterPx);
  const heroVisualKind: 'vinyl' | 'poster' | 'none' =
    vinylDiscPx >= posterPx && vinylDiscPx > 0
      ? 'vinyl'
      : posterPx > 0
        ? 'poster'
        : 'none';
  const combinedDock = Boolean(document.querySelector('[data-testid="mobile-combined-dock"]'));
  const miniPlayerVisible = Boolean(
    document.querySelector(
      '.mobile-combined-dock-player [data-testid="player-bar"], .mobile-combined-dock-player .player-bar',
    ),
  );
  return {
    homeCompact: Boolean(document.querySelector('.home-view--compact')),
    hasVinylDisc: Boolean(disc),
    hasPoster: Boolean(posterWrap),
    vinylDiscPx,
    posterPx,
    heroVisualPx,
    heroVisualKind,
    hasHeroTitle: Boolean(document.querySelector('.home-hero-title')?.textContent?.trim()),
    combinedDock,
    miniPlayerVisible,
    nowPlayingOpen: Boolean(document.querySelector('.mobile-now-playing--sheet-open')),
    shellNowPlayingClass: Boolean(document.querySelector('.shell-root--now-playing-open')),
  };
}

/** True when the mobile now-playing sheet is visibly open (state or DOM). */
export function isNowPlayingSheetDomOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.querySelector('.shell-root--now-playing-open') ||
      document.querySelector('.mobile-now-playing--sheet-open'),
  );
}

/** DOM probe for automation — poster vs vinyl hero on home / now playing. */
export function probeHeroVisualFromDom(): HeroVisualProbe {
  if (typeof document === 'undefined') {
    return { visual: 'none', expanded: false, settingsOpen: false, hasArt: false };
  }
  const universe = document.querySelector('.home-vinyl-universe');
  const isPoster =
    Boolean(universe?.classList.contains('home-vinyl-universe--poster')) &&
    Boolean(document.querySelector('.home-hero-poster'));
  const hasVinylDisc = Boolean(document.querySelector('.home-vinyl-disc.vinyl-disc'));
  const visual: HeroVisualProbe['visual'] = isPoster ? 'poster' : hasVinylDisc ? 'vinyl' : 'none';
  const expanded =
    Boolean(universe?.classList.contains('home-vinyl-universe--expanded')) ||
    Boolean(document.querySelector('.home-view--expanded')) ||
    Boolean(document.querySelector('.shell-root--now-playing-open'));
  const settingsOpen = Boolean(
    document.querySelector('[data-testid="mobile-home-vinyl-settings-sheet"]'),
  );
  const hasArt =
    isPoster ||
    Boolean(document.querySelector('.home-vinyl-disc.has-art')) ||
    Boolean(document.querySelector('.home-hero-poster[src]'));
  return { visual, expanded, settingsOpen, hasArt };
}

export function displayHeroArtist(artist: string, album?: string): string {
  const a = (artist ?? '').trim();
  if (!a || PLACEHOLDER_ARTIST_RE.test(a.replace(/\s+/g, ' '))) {
    return album?.trim() ?? '';
  }
  return a;
}
