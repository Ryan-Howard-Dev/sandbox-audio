import { describe, expect, it } from 'vitest';
import { APP_ICONS, isAppIconKey } from './appIcon';

describe('the icon list', () => {
  it('offers a default plus the three alternatives', () => {
    expect(APP_ICONS.map((i) => i.key)).toEqual([
      'default',
      'bloodorange',
      'graphite',
      'terminal',
    ]);
  });

  it('gives every icon a swatch, so the picker needs no extra bitmaps', () => {
    for (const icon of APP_ICONS) {
      expect(icon.background, icon.key).toMatch(/^#[0-9A-F]{6}$/);
      expect(icon.foreground, icon.key).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('gives every icon a translated label rather than a hard-coded name', () => {
    for (const icon of APP_ICONS) {
      expect(icon.labelKey, icon.key).toMatch(/^settings\./);
    }
  });

  it('keeps every icon visibly distinct', () => {
    // Four icons that look alike is the theme-picker mistake in a smaller frame.
    const backgrounds = new Set(APP_ICONS.map((i) => i.background));
    const foregrounds = new Set(APP_ICONS.map((i) => i.foreground));
    expect(backgrounds.size).toBe(APP_ICONS.length);
    expect(foregrounds.size).toBe(APP_ICONS.length);
  });
});

describe('isAppIconKey', () => {
  it('accepts the keys that exist', () => {
    for (const icon of APP_ICONS) expect(isAppIconKey(icon.key)).toBe(true);
  });

  it('rejects anything else, so a stale stored value cannot select a missing alias', () => {
    // A key with no manifest alias behind it would disable every launcher component and the app
    // would vanish from the home screen.
    expect(isAppIconKey('sepia')).toBe(false);
    expect(isAppIconKey('')).toBe(false);
    expect(isAppIconKey('DEFAULT')).toBe(false);
  });
});
