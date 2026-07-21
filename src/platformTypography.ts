/**
 * Global UI font + size — applied on :root for the whole shell.
 */

import { detectDesktopOs, isTauri } from './platformEnv';

export type PlatformFontId = 'plex-mono' | 'barlow' | 'jetbrains' | 'inter';

export const PLATFORM_FONTS: Record<
  PlatformFontId,
  { label: string; stack: string; displayStack?: string }
> = {
  'plex-mono': {
    label: 'Terminal Mono',
    stack: '"IBM Plex Mono", ui-monospace, monospace',
    displayStack: '"Barlow Condensed", sans-serif',
  },
  barlow: {
    label: 'Command Display',
    stack: '"Barlow Condensed", "IBM Plex Mono", sans-serif',
    displayStack: '"Barlow Condensed", sans-serif',
  },
  jetbrains: {
    label: 'Signal Code',
    stack: '"JetBrains Mono", ui-monospace, monospace',
    displayStack: '"Barlow Condensed", sans-serif',
  },
  inter: {
    label: 'Clean Ops',
    stack: '"Inter", system-ui, sans-serif',
    displayStack: '"Inter", system-ui, sans-serif',
  },
};

const FONT_ID_KEY = 'sandbox_ui_font_id';
const FONT_SIZE_KEY = 'sandbox_ui_font_size';
/** Legacy architect-tab key — kept in sync with FONT_ID_KEY. */
export const LEGACY_FONT_KEY = 'sandbox_font';

const LEGACY_FONT_TO_ID: Record<string, PlatformFontId> = {
  'IBM Plex Mono': 'plex-mono',
  'JetBrains Mono': 'jetbrains',
  'sans-serif': 'inter',
  Inter: 'inter',
};

const FONT_ID_TO_LEGACY: Record<PlatformFontId, string> = {
  'plex-mono': 'IBM Plex Mono',
  barlow: 'IBM Plex Mono',
  jetbrains: 'JetBrains Mono',
  inter: 'sans-serif',
};

export const DEFAULT_FONT_SIZE = 14;
/** First-launch base size for Tauri on Windows (100% DPI, 1280×720 default window). */
export const TAURI_WINDOWS_DEFAULT_FONT_SIZE = 16;

function defaultFontSizePx(): number {
  if (isTauri() && detectDesktopOs() === 'windows') {
    return TAURI_WINDOWS_DEFAULT_FONT_SIZE;
  }
  return DEFAULT_FONT_SIZE;
}

export function architectFontToPlatformId(font: string): PlatformFontId {
  return LEGACY_FONT_TO_ID[font] ?? 'inter';
}

export function platformIdToArchitectFont(fontId: PlatformFontId): string {
  return FONT_ID_TO_LEGACY[fontId] ?? 'sans-serif';
}

export function loadPlatformTypography(): { fontId: PlatformFontId; sizePx: number } {
  const rawId = localStorage.getItem(FONT_ID_KEY) as PlatformFontId | null;
  const legacyFont = localStorage.getItem(LEGACY_FONT_KEY);
  let fontId: PlatformFontId =
    rawId && rawId in PLATFORM_FONTS ? rawId : 'inter';
  if (legacyFont && legacyFont in LEGACY_FONT_TO_ID) {
    const legacyId = LEGACY_FONT_TO_ID[legacyFont];
    if (!rawId || (rawId === 'plex-mono' && legacyId !== 'plex-mono')) {
      fontId = legacyId;
    }
  }
  const rawSize = parseInt(localStorage.getItem(FONT_SIZE_KEY) ?? '', 10);
  const sizePx =
    Number.isFinite(rawSize) && rawSize >= 12 && rawSize <= 24
      ? rawSize
      : defaultFontSizePx();
  return { fontId, sizePx };
}

export function applyPlatformTypography(fontId: PlatformFontId, sizePx: number): void {
  const clamped = Math.max(12, Math.min(24, sizePx));
  const font = PLATFORM_FONTS[fontId];
  const root = document.documentElement;
  const sizeValue = `${clamped}px`;
  root.style.setProperty('--font-ui', font.stack);
  root.style.setProperty('--font-sans', font.stack);
  root.style.setProperty(
    '--font-display',
    font.displayStack ?? '"Barlow Condensed", sans-serif',
  );
  // Tailwind `font-mono` + fixed-width UI slots follow the active UI preset.
  root.style.setProperty('--font-mono', font.stack);
  root.style.setProperty('--sandbox-font-size-base', sizeValue);
  root.style.setProperty('--sandbox-font-size', sizeValue);
  root.style.setProperty('--app-font-size', sizeValue);
  // rem-based UI scales from html root font-size.
  root.style.fontSize = sizeValue;
  localStorage.setItem(FONT_ID_KEY, fontId);
  localStorage.setItem(FONT_SIZE_KEY, String(clamped));
  localStorage.setItem(LEGACY_FONT_KEY, FONT_ID_TO_LEGACY[fontId]);
  window.dispatchEvent(new Event('sandbox-typography-change'));
}

export function initPlatformTypography(): { fontId: PlatformFontId; sizePx: number } {
  const state = loadPlatformTypography();
  applyPlatformTypography(state.fontId, state.sizePx);
  return state;
}
