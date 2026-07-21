import { describe, expect, it, vi } from 'vitest';
import {
  applyHeroDisplayFromSettingsEvent,
  heroDisplayFromSettingsEvent,
} from './heroDisplaySettings';

describe('heroDisplaySettings', () => {
  it('ignores bare sandbox-settings-change broadcasts', () => {
    let mode: 'album-cover' | 'vinyl-shades' = 'vinyl-shades';
    applyHeroDisplayFromSettingsEvent(new Event('sandbox-settings-change'), (next) => {
      mode = next;
    });
    expect(mode).toBe('vinyl-shades');
  });

  it('applies explicit hero display detail from settings events', () => {
    let mode: 'album-cover' | 'vinyl-shades' = 'album-cover';
    applyHeroDisplayFromSettingsEvent(
      new CustomEvent('sandbox-settings-change', {
        detail: { heroDisplayMode: 'vinyl-shades' },
      }),
      (next) => {
        mode = next;
      },
    );
    expect(mode).toBe('vinyl-shades');
    expect(heroDisplayFromSettingsEvent(new Event('sandbox-settings-change'))).toBeNull();
  });


  it('does not revert when a bare event follows a hero toggle', () => {
    let mode: 'album-cover' | 'vinyl-shades' = 'album-cover';
    const setMode = vi.fn((next: 'album-cover' | 'vinyl-shades') => {
      mode = next;
    });
    applyHeroDisplayFromSettingsEvent(
      new CustomEvent('sandbox-settings-change', {
        detail: { heroDisplayMode: 'vinyl-shades' },
      }),
      setMode,
    );
    applyHeroDisplayFromSettingsEvent(new Event('sandbox-settings-change'), setMode);
    expect(mode).toBe('vinyl-shades');
    expect(setMode).toHaveBeenCalledTimes(1);
  });
});
