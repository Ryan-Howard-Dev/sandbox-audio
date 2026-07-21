import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import {
  applyHeroDisplayFromSettingsEvent,
  loadHeroDisplayMode,
  saveHeroDisplayMode,
  type HeroDisplayMode,
} from '../heroDisplaySettings';
import {
  loadVinylVisualSettings,
  saveVinylVisualSettings,
  loadVinylDiscColor,
  saveVinylDiscColor,
  MOBILE_VINYL_VISUAL_PRESETS,
  VINYL_DISC_COLORS,
  type MobileVinylVisualPresetId,
  type VinylVisualSettings,
} from '../vinylVisualSettings';
import {
  loadVinylDisplayMode,
  saveVinylDisplayMode,
  type VinylDisplayMode,
} from '../vinylDisplaySettings';
import { applyThemePreset, resolveThemeTone } from '../engineTheme';
import { getMobileThemePresets } from '../themePresets';
import { useTranslation } from '../i18n';

function isMobileVisualPresetActive(
  vinylVisuals: VinylVisualSettings,
  presetId: MobileVinylVisualPresetId,
): boolean {
  const preset = MOBILE_VINYL_VISUAL_PRESETS[presetId];
  return (Object.keys(preset) as (keyof VinylVisualSettings)[]).every(
    (key) => vinylVisuals[key] === preset[key],
  );
}

const MOBILE_VISUAL_PRESET_OPTIONS = [
  { id: 'subtle' as const, labelKey: 'settings.vinyl.mobilePresetSubtle' },
  { id: 'glow' as const, labelKey: 'settings.vinyl.mobilePresetGlow' },
] as const;

const MOBILE_VISUAL_SLIDERS = [
  { key: 'artBlend' as const, labelKey: 'settings.vinyl.mobileArtBlend' },
  { key: 'universeIntensity' as const, labelKey: 'settings.vinyl.mobileUniverseIntensity' },
  { key: 'colorThrow' as const, labelKey: 'settings.vinyl.mobileColorThrow' },
  { key: 'pulse' as const, labelKey: 'settings.vinyl.mobilePulse' },
] as const;

const MOBILE_DISPLAY_MODES = [
  { id: 'manual' as const, labelKey: 'settings.vinyl.displayModeManual' },
  { id: 'follow-art' as const, labelKey: 'settings.vinyl.mobileDisplayFollowArt' },
  { id: 'follow-genre' as const, labelKey: 'settings.vinyl.displayModeFollowGenre' },
] as const;

export interface MobileHomeVinylSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileHomeVinylSettingsSheet({
  open,
  onClose,
}: MobileHomeVinylSettingsSheetProps) {
  const { t } = useTranslation();
  const mobileThemePresets = getMobileThemePresets();
  const [heroDisplay, setHeroDisplay] = useState<HeroDisplayMode>(loadHeroDisplayMode);
  const [vinylVisuals, setVinylVisuals] = useState<VinylVisualSettings>(loadVinylVisualSettings);
  const [discColor, setDiscColor] = useState<string>(loadVinylDiscColor);
  const [displayMode, setDisplayMode] = useState<VinylDisplayMode>(loadVinylDisplayMode);
  const [themeTone, setThemeTone] = useState(resolveThemeTone);

  useDismissableOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    setHeroDisplay(loadHeroDisplayMode());
    setVinylVisuals(loadVinylVisualSettings());
    setDiscColor(loadVinylDiscColor());
    setDisplayMode(loadVinylDisplayMode());
    setThemeTone(resolveThemeTone());
  }, [open]);

  useEffect(() => {
    const syncSettings = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplay);
      setVinylVisuals(loadVinylVisualSettings());
      setDiscColor(loadVinylDiscColor());
      setDisplayMode(loadVinylDisplayMode());
    };
    const syncTheme = () => setThemeTone(resolveThemeTone());
    window.addEventListener('sandbox-settings-change', syncSettings);
    window.addEventListener('sandbox-theme-change', syncTheme);
    return () => {
      window.removeEventListener('sandbox-settings-change', syncSettings);
      window.removeEventListener('sandbox-theme-change', syncTheme);
    };
  }, []);

  const patchVinylVisual = useCallback((patch: Partial<VinylVisualSettings>) => {
    const next = { ...loadVinylVisualSettings(), ...patch };
    setVinylVisuals(next);
    saveVinylVisualSettings(next);
  }, []);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="mobile-home-vinyl-sheet-overlay"
      role="presentation"
      data-testid="mobile-home-vinyl-settings-sheet"
    >
      <button
        type="button"
        className="mobile-home-vinyl-sheet-backdrop"
        aria-label={t('home.vinylSettingsClose')}
        onClick={onClose}
      />
      <div
        className="mobile-home-vinyl-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-home-vinyl-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mobile-home-vinyl-sheet-header">
          <h2 id="mobile-home-vinyl-settings-title" className="mobile-home-vinyl-sheet-title">
            {t('home.vinylSettingsTitle')}
          </h2>
          <button
            type="button"
            className="mobile-home-vinyl-sheet-close touch-manipulation"
            onClick={onClose}
            aria-label={t('home.vinylSettingsClose')}
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </header>

        <div className="mobile-home-vinyl-sheet-body music-scrollbar">
          <section className="mobile-home-vinyl-sheet-section">
            <p className="mobile-home-vinyl-sheet-label">
              {t('settings.vinyl.mobileHeroDisplayTitle')}
            </p>
            <p className="mobile-home-vinyl-sheet-hint">
              {t('settings.vinyl.mobileHeroDisplayHint')}
            </p>
            <div className="mobile-home-vinyl-sheet-chip-row">
              {(
                [
                  {
                    id: 'album-cover' as const,
                    labelKey: 'settings.architect.heroDisplayAlbumCover',
                  },
                  {
                    id: 'vinyl-shades' as const,
                    labelKey: 'settings.architect.heroDisplayVinylShades',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`mobile-home-vinyl-sheet-chip touch-manipulation${
                    heroDisplay === opt.id ? ' mobile-home-vinyl-sheet-chip--active' : ''
                  }`}
                  data-testid={`mobile-hero-display-${opt.id}`}
                  onClick={() => {
                    setHeroDisplay(opt.id);
                    saveHeroDisplayMode(opt.id);
                  }}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </section>

          <section className="mobile-home-vinyl-sheet-section">
            <p className="mobile-home-vinyl-sheet-label">Vinyl disc colour</p>
            <p className="mobile-home-vinyl-sheet-hint">
              Tint the spinning record. Sandbox orange is the default brand colour.
            </p>
            <div className="mobile-home-vinyl-sheet-disc-colors">
              {VINYL_DISC_COLORS.map((swatch) => {
                const active =
                  swatch.value === ''
                    ? discColor === ''
                    : discColor === swatch.value;
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    className={`mobile-home-vinyl-sheet-disc-color touch-manipulation${
                      active ? ' mobile-home-vinyl-sheet-disc-color--active' : ''
                    }`}
                    data-testid={`mobile-vinyl-disc-color-${swatch.id}`}
                    aria-label={swatch.label}
                    aria-pressed={active}
                    title={swatch.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiscColor(swatch.value);
                      saveVinylDiscColor(swatch.value);
                    }}
                  >
                    <span
                      className="mobile-home-vinyl-sheet-disc-color-dot"
                      style={{
                        background:
                          swatch.value ||
                          'repeating-conic-gradient(#222 0deg 90deg, #444 90deg 180deg)',
                      }}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mobile-home-vinyl-sheet-section">
            <p className="mobile-home-vinyl-sheet-label">
              {t('settings.vinyl.mobileThemeTitle')}
            </p>
            <p className="mobile-home-vinyl-sheet-hint">
              {t('settings.vinyl.mobileThemeHint')}
            </p>
            <div className="mobile-home-vinyl-sheet-theme-grid">
              {mobileThemePresets.map((preset) => (
                <button
                  key={preset.toneKey}
                  type="button"
                  className={`mobile-home-vinyl-sheet-theme touch-manipulation${
                    themeTone === preset.toneKey
                      ? ' mobile-home-vinyl-sheet-theme--active'
                      : ''
                  }`}
                  data-testid={`mobile-vinyl-theme-${preset.presetKey}`}
                  onClick={() => {
                    applyThemePreset(preset.toneKey, {
                      h: preset.focusH,
                      s: preset.focusS,
                      l: preset.focusL,
                      hex: preset.focusHex,
                    });
                    setThemeTone(preset.toneKey);
                  }}
                >
                  <span
                    className="mobile-home-vinyl-sheet-theme-swatch"
                    style={{ background: preset.focusHex }}
                    aria-hidden
                  />
                  <span className="mobile-home-vinyl-sheet-theme-name">
                    {t(`settings.architect.presets.${preset.presetKey}`)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mobile-home-vinyl-sheet-section">
            <p className="mobile-home-vinyl-sheet-label">
              {t('settings.vinyl.displayModeTitle')}
            </p>
            <div className="mobile-home-vinyl-sheet-chip-row">
              {MOBILE_DISPLAY_MODES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`mobile-home-vinyl-sheet-chip touch-manipulation${
                    displayMode === opt.id ? ' mobile-home-vinyl-sheet-chip--active' : ''
                  }`}
                  data-testid={`mobile-vinyl-display-${opt.id}`}
                  onClick={() => {
                    setDisplayMode(opt.id);
                    saveVinylDisplayMode(opt.id);
                    if (opt.id === 'follow-art' && loadVinylVisualSettings().artBlend <= 0) {
                      patchVinylVisual({ artBlend: 85 });
                    }
                  }}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </section>

          <section className="mobile-home-vinyl-sheet-section">
            <p className="mobile-home-vinyl-sheet-label">
              {t('settings.vinyl.mobileVisualTitle')}
            </p>
            <p className="mobile-home-vinyl-sheet-hint">
              {t('settings.vinyl.mobileVisualHint')}
            </p>
            <div className="mobile-home-vinyl-sheet-chip-row">
              {MOBILE_VISUAL_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`mobile-home-vinyl-sheet-chip touch-manipulation${
                    isMobileVisualPresetActive(vinylVisuals, preset.id)
                      ? ' mobile-home-vinyl-sheet-chip--active'
                      : ''
                  }`}
                  data-testid={`mobile-vinyl-preset-${preset.id}`}
                  onClick={() => {
                    const next = {
                      ...loadVinylVisualSettings(),
                      ...MOBILE_VINYL_VISUAL_PRESETS[preset.id],
                    };
                    setVinylVisuals(next);
                    saveVinylVisualSettings(next);
                  }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            {MOBILE_VISUAL_SLIDERS.map((slider) => (
              <div key={slider.key} className="mobile-home-vinyl-sheet-slider">
                <div className="mobile-home-vinyl-sheet-slider-head">
                  <label className="mobile-home-vinyl-sheet-slider-label">
                    {t(slider.labelKey)}
                  </label>
                  <span className="mobile-home-vinyl-sheet-slider-value">
                    {vinylVisuals[slider.key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={vinylVisuals[slider.key]}
                  onChange={(e) =>
                    patchVinylVisual({ [slider.key]: parseInt(e.target.value, 10) })
                  }
                  className="mobile-home-vinyl-sheet-range accent-accent"
                  aria-label={t(slider.labelKey)}
                  data-testid={`mobile-vinyl-slider-${slider.key}`}
                />
              </div>
            ))}
            <p className="mobile-home-vinyl-sheet-hint">{t('settings.vinyl.mobilePreviewNote')}</p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
