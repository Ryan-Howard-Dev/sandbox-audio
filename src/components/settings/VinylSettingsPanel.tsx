import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { C } from '../../stations/theme';
import {
  isAddonSupportedOnDevice,
  type RecordPlayerAddon,
  type RecordPlayerCatalogEntry,
} from '../../recordPlayerAddons';
import {
  saveVinylDisplayMode,
  type VinylDisplayMode,
} from '../../vinylDisplaySettings';
import {
  VINYL_VISUAL_PRESETS,
  type VinylVisualSettings,
  loadVinylVisualSettings,
} from '../../vinylVisualSettings';
import {
  GENRE_BUCKET_LABELS,
  getPickableGenreShades,
  loadGenreOverrides,
  resolveGenreShade,
  saveGenreOverride,
  type VinylGenreBucket,
} from '../../vinylGenreThemes';
import { usesVinylPreviewQualityProfile } from '../../vinylVisualCapabilities';
import type { VinylShade } from '../../vinylShadePalette';
import { useTranslation } from '../../i18n';
import SettingsSectionAnchor from './SettingsSectionAnchor';
import { SETTINGS_SEARCH_ANCHORS } from './settingsSearchAnchors';

const accentStyle = { color: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' };
const accentBgSoft = {
  backgroundColor: 'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)',
};

function vinylChipStyle(
  isActive: boolean,
  borderRadius: string,
  cardStyle: React.CSSProperties,
): React.CSSProperties {
  return {
    borderRadius,
    borderColor: isActive
      ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
      : 'var(--border)',
    ...(isActive ? accentBgSoft : cardStyle),
  };
}

function isVisualPresetActive(
  vinylVisuals: VinylVisualSettings,
  presetId: keyof typeof VINYL_VISUAL_PRESETS,
): boolean {
  const preset = VINYL_VISUAL_PRESETS[presetId];
  return (Object.keys(preset) as (keyof VinylVisualSettings)[]).every(
    (key) => vinylVisuals[key] === preset[key],
  );
}

interface VinylGenreShadeRowProps {
  bucket: VinylGenreBucket;
  shade: VinylShade;
  shades: VinylShade[];
  isOpen: boolean;
  isOverridden: boolean;
  onToggle: () => void;
  onSelect: (shadeId: string) => void;
  pickerLabel: string;
  shadeBarLabel: string;
}

function VinylGenreShadeRow({
  bucket,
  shade,
  shades,
  isOpen,
  isOverridden,
  onToggle,
  onSelect,
  pickerLabel,
  shadeBarLabel,
}: VinylGenreShadeRowProps) {
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(0, shades.findIndex((s) => s.id === shade.id)),
  );

  useEffect(() => {
    if (!isOpen) return;
    const idx = shades.findIndex((s) => s.id === shade.id);
    setFocusIndex(idx >= 0 ? idx : 0);
  }, [isOpen, shade.id, shades]);

  useEffect(() => {
    if (!isOpen) return;
    swatchRefs.current[focusIndex]?.focus();
  }, [isOpen, focusIndex]);

  const handleBarKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  const handleSwatchKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusIndex((i) => (i + 1) % shades.length);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusIndex((i) => (i - 1 + shades.length) % shades.length);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocusIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocusIndex(shades.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(shades[index].id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onToggle();
      }
    },
    [onSelect, onToggle, shades],
  );

  return (
    <li className="vinyl-genre-shade-row">
      <div className="vinyl-genre-shade-row__main">
        <span className="vinyl-genre-shade-row__label font-mono text-xs uppercase text-[var(--text-mid)]">
          {GENRE_BUCKET_LABELS[bucket]}
        </span>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={shadeBarLabel}
          onClick={onToggle}
          onKeyDown={handleBarKeyDown}
          className={`vinyl-genre-shade-bar touch-manipulation${isOpen ? ' vinyl-genre-shade-bar--open' : ''}${isOverridden ? ' vinyl-genre-shade-bar--custom' : ''}`}
          style={{ background: shade.previewGradient }}
        />
      </div>
      {isOpen ? (
        <div
          role="listbox"
          aria-label={pickerLabel}
          className="vinyl-genre-shade-strip"
        >
          {shades.map((option, index) => {
            const selected = option.id === shade.id;
            return (
              <button
                key={option.id}
                ref={(el) => {
                  swatchRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={option.name}
                title={option.name}
                tabIndex={focusIndex === index ? 0 : -1}
                onClick={() => onSelect(option.id)}
                onKeyDown={(e) => handleSwatchKeyDown(e, index)}
                className={`vinyl-genre-shade-swatch touch-manipulation${selected ? ' vinyl-genre-shade-swatch--selected' : ''}`}
                style={{ background: option.previewGradient }}
              />
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

export interface VinylSettingsPanelProps {
  vinylVisuals: VinylVisualSettings;
  onPatchVinylVisual: (patch: Partial<VinylVisualSettings>) => void;
  onSetVinylVisuals: (next: VinylVisualSettings) => void;
  displayMode: VinylDisplayMode;
  onDisplayModeChange: (mode: VinylDisplayMode) => void;
  officialPresets: RecordPlayerAddon[];
  communityPacks: RecordPlayerAddon[];
  activeRecordPlayerAddonId: string;
  onSetActivePreset: (id: string) => void;
  onRemoveCommunityPack: (id: string) => void;
  recordPlayerAddonUrl: string;
  onRecordPlayerAddonUrlChange: (url: string) => void;
  onInstallFromUrl: () => void;
  onInstallCatalogEntry: (entry: RecordPlayerCatalogEntry) => void;
  onBrowseCatalog: () => void;
  onImportClipboard: () => void;
  recordPlayerAddonStatus: string;
  recordPlayerAddonInstalling: boolean;
  recordPlayerCatalog: RecordPlayerCatalogEntry[] | null;
  recordPlayerCatalogLoading: boolean;
  recordPlayerAddonUrlRef: React.RefObject<HTMLInputElement | null>;
  borderRadius: string;
  cardStyle: React.CSSProperties;
}

export default function VinylSettingsPanel({
  vinylVisuals,
  onPatchVinylVisual,
  onSetVinylVisuals,
  displayMode,
  onDisplayModeChange,
  officialPresets,
  communityPacks,
  activeRecordPlayerAddonId,
  onSetActivePreset,
  onRemoveCommunityPack,
  recordPlayerAddonUrl,
  onRecordPlayerAddonUrlChange,
  onInstallFromUrl,
  onInstallCatalogEntry,
  onBrowseCatalog,
  onImportClipboard,
  recordPlayerAddonStatus,
  recordPlayerAddonInstalling,
  recordPlayerCatalog,
  recordPlayerCatalogLoading,
  recordPlayerAddonUrlRef,
  borderRadius,
  cardStyle,
}: VinylSettingsPanelProps) {
  const { t } = useTranslation();
  const isManual = displayMode === 'manual' || displayMode === 'follow-art';
  const vinylPreviewQuality = usesVinylPreviewQualityProfile();
  const genreBuckets = Object.keys(GENRE_BUCKET_LABELS) as VinylGenreBucket[];
  const pickableShades = getPickableGenreShades();
  const [genreOverrides, setGenreOverrides] = useState(loadGenreOverrides);
  const [openPickerBucket, setOpenPickerBucket] = useState<VinylGenreBucket | null>(null);
  const genreListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sync = () => setGenreOverrides(loadGenreOverrides());
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  useEffect(() => {
    if (!openPickerBucket) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (genreListRef.current && !genreListRef.current.contains(event.target as Node)) {
        setOpenPickerBucket(null);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [openPickerBucket]);

  const renderPresetCard = (addon: RecordPlayerAddon, showUse: boolean) => {
    const isActive = activeRecordPlayerAddonId === addon.id;
    const supported = isAddonSupportedOnDevice(addon);
    const previewStyle =
      addon.preview?.startsWith('linear-gradient') || addon.preview?.startsWith('radial-gradient')
        ? { background: addon.preview }
        : undefined;

    return (
      <li
        key={addon.id}
        className="flex items-start justify-between gap-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]"
      >
        <div className="flex gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl border border-[var(--border)] shrink-0 flex items-center justify-center text-lg overflow-hidden"
            style={previewStyle}
            aria-hidden
          >
            {!previewStyle ? (addon.preview ?? '💿') : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-[var(--text)] truncate">{addon.name}</p>
              {isActive && showUse ? (
                <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border theme-badge">
                  {t('settings.vinyl.presetActiveBadge')}
                </span>
              ) : null}
              {!supported ? (
                <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border text-[var(--text-dim)] border-[var(--border)]">
                  {t('settings.vinyl.presetUnsupported')}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-[var(--text-mid)]">{addon.description}</p>
          </div>
        </div>
        {showUse ? (
          <button
            type="button"
            disabled={isActive || !supported}
            onClick={() => onSetActivePreset(addon.id)}
            className={`text-sm font-bold uppercase touch-manipulation px-3 py-1 shrink-0 rounded-lg border transition-colors${
              isActive ? ' theme-badge' : ''
            }`}
            style={accentStyle}
          >
            {isActive ? t('settings.vinyl.presetActiveBadge') : t('settings.vinyl.presetUse')}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
          {t('settings.vinyl.title')}
        </p>
        <p className="ui-hint mt-1">{t('settings.vinyl.hint')}</p>
        {vinylPreviewQuality ? (
          <p
            className="ui-hint mt-2 p-3 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--text-mid)]"
            role="status"
          >
            {t('settings.vinyl.mobilePreviewNote')}
          </p>
        ) : null}
      </div>

      <div className="settings-anchor-section space-y-3">
        <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vinylDisplay} />
        <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
          {t('settings.vinyl.displayModeTitle')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              { id: 'manual' as const, labelKey: 'settings.vinyl.displayModeManual', hintKey: 'settings.vinyl.displayModeManualHint' },
              { id: 'follow-art' as const, labelKey: 'settings.vinyl.displayModeFollowArt', hintKey: 'settings.vinyl.displayModeFollowArtHint' },
              { id: 'follow-genre' as const, labelKey: 'settings.vinyl.displayModeFollowGenre', hintKey: 'settings.vinyl.displayModeFollowGenreHint' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onDisplayModeChange(opt.id);
                saveVinylDisplayMode(opt.id);
                if (opt.id === 'follow-art' && loadVinylVisualSettings().artBlend <= 0) {
                  onPatchVinylVisual({ artBlend: 85 });
                }
              }}
              className="p-4 rounded-xl border text-left touch-manipulation transition-colors vinyl-settings-option"
              style={{
                ...vinylChipStyle(displayMode === opt.id, borderRadius, cardStyle),
              }}
            >
              <p
                className="font-mono text-xs font-bold uppercase"
                style={displayMode === opt.id ? accentStyle : { color: C.text }}
              >
                {t(opt.labelKey)}
              </p>
              <p className="ui-hint mt-1">{t(opt.hintKey)}</p>
            </button>
          ))}
        </div>
      </div>

      {isManual ? (
        <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
          <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vinylOfficial} />
          <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
            {t('settings.vinyl.officialPresetsTitle')}
          </p>
          <p className="ui-hint">{t('settings.vinyl.officialPresetsHint')}</p>
          <ul className="space-y-2">{officialPresets.map((p) => renderPresetCard(p, true))}</ul>
        </div>
      ) : (
        <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
          <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vinylGenre} />
          <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
            {t('settings.vinyl.genreMappingTitle')}
          </p>
          <p className="ui-hint">{t('settings.vinyl.genreMappingHint')}</p>
          <ul className="vinyl-genre-shade-list space-y-2" ref={genreListRef}>
            {genreBuckets.map((bucket) => {
              const shade = resolveGenreShade(bucket);
              const isOpen = openPickerBucket === bucket;
              const isOverridden = genreOverrides[bucket] !== undefined;
              return (
                <React.Fragment key={bucket}>
                <VinylGenreShadeRow
                  bucket={bucket}
                  shade={shade}
                  shades={pickableShades}
                  isOpen={isOpen}
                  isOverridden={isOverridden}
                  onToggle={() => setOpenPickerBucket(isOpen ? null : bucket)}
                  onSelect={(shadeId) => {
                    saveGenreOverride(bucket, shadeId);
                    setOpenPickerBucket(null);
                  }}
                  pickerLabel={t('settings.vinyl.genreMappingPickerLabel', {
                    genre: GENRE_BUCKET_LABELS[bucket],
                  })}
                  shadeBarLabel={t('settings.vinyl.genreMappingShadeBarLabel', {
                    genre: GENRE_BUCKET_LABELS[bucket],
                    shade: shade.name,
                  })}
                />
                </React.Fragment>
              );
            })}
          </ul>
        </div>
      )}

      <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
        <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vinylVisuals} />
        <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
          {t('settings.vinyl.visualSlidersTitle')}
        </p>
        <p className="ui-hint">{t('settings.vinyl.visualSlidersHint')}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'subtle' as const, labelKey: 'settings.vinyl.presetSubtle' },
              { id: 'trip' as const, labelKey: 'settings.vinyl.presetTrip' },
              { id: 'dmt' as const, labelKey: 'settings.vinyl.presetDmt' },
            ] as const
          ).map((preset) => {
            const isActive = isVisualPresetActive(vinylVisuals, preset.id);
            return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSetVinylVisuals({ ...VINYL_VISUAL_PRESETS[preset.id] })}
              className="px-3 py-1.5 rounded-lg border font-mono text-[10px] uppercase tracking-wider touch-manipulation transition-colors vinyl-settings-option"
              style={{
                ...vinylChipStyle(isActive, borderRadius, cardStyle),
                color: isActive ? undefined : C.text,
                ...(isActive ? accentStyle : {}),
              }}
            >
              {t(preset.labelKey)}
            </button>
            );
          })}
        </div>
        {(
          [
            { key: 'artBlend' as const, labelKey: 'settings.vinyl.artBlend', hintKey: 'settings.vinyl.artBlendHint' },
            { key: 'universeIntensity' as const, labelKey: 'settings.vinyl.universeIntensity', hintKey: 'settings.vinyl.universeIntensityHint' },
            { key: 'colorThrow' as const, labelKey: 'settings.vinyl.colorThrow', hintKey: 'settings.vinyl.colorThrowHint' },
            { key: 'pulse' as const, labelKey: 'settings.vinyl.pulse', hintKey: 'settings.vinyl.pulseHint' },
            { key: 'hueDrift' as const, labelKey: 'settings.vinyl.hueDrift', hintKey: 'settings.vinyl.hueDriftHint' },
            { key: 'spinTrail' as const, labelKey: 'settings.vinyl.spinTrail', hintKey: 'settings.vinyl.spinTrailHint' },
            { key: 'warp' as const, labelKey: 'settings.vinyl.warp', hintKey: 'settings.vinyl.warpHint' },
          ] as const
        ).map((slider) => (
          <div key={slider.key}>
            <div className="flex justify-between mb-1">
              <label className="ui-field-label ui-field-label--inline">{t(slider.labelKey)}</label>
              <span className="font-mono text-xs font-bold" style={accentStyle}>
                {vinylVisuals[slider.key]}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={vinylVisuals[slider.key]}
              onChange={(e) => onPatchVinylVisual({ [slider.key]: parseInt(e.target.value, 10) })}
              className="w-full accent-accent"
              aria-label={t(slider.labelKey)}
            />
            <p className="ui-hint mt-1">{t(slider.hintKey)}</p>
          </div>
        ))}
      </div>

      <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
        <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vinylCommunity} />
        <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
          {t('settings.vinyl.communityPacksTitle')}
        </p>
        <p className="ui-hint">{t('settings.vinyl.communityPacksHint')}</p>

        {communityPacks.length === 0 ? (
          <p className="ui-hint p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            {t('settings.vinyl.communityEmpty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {communityPacks.map((addon) => {
              const isActive = activeRecordPlayerAddonId === addon.id;
              const supported = isAddonSupportedOnDevice(addon);
              const previewStyle =
                addon.preview?.startsWith('linear-gradient') ||
                addon.preview?.startsWith('radial-gradient')
                  ? { background: addon.preview }
                  : undefined;
              return (
                <li
                  key={addon.id}
                  className="flex items-start justify-between gap-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]"
                >
                  <div className="flex gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl border border-[var(--border)] shrink-0 flex items-center justify-center text-lg overflow-hidden"
                      style={previewStyle}
                      aria-hidden
                    >
                      {!previewStyle ? (addon.preview ?? '💿') : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[var(--text)] truncate">{addon.name}</p>
                        {isActive && isManual ? (
                          <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border theme-badge">
                            {t('settings.vinyl.presetActiveBadge')}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-[var(--text-mid)]">
                        {t('settings.vinyl.communityPackBy', { author: addon.author })} · v{addon.version}
                      </p>
                      <p className="ui-hint mt-0.5">{addon.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {isManual ? (
                      <button
                        type="button"
                        disabled={isActive || !supported}
                        onClick={() => onSetActivePreset(addon.id)}
                        className={`text-sm font-bold uppercase touch-manipulation px-3 py-1 rounded-lg border transition-colors${
                          isActive ? ' theme-badge' : ''
                        }`}
                        style={accentStyle}
                      >
                        {isActive ? t('settings.vinyl.presetActiveBadge') : t('settings.vinyl.presetUse')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRemoveCommunityPack(addon.id)}
                      className="text-sm font-bold uppercase text-[var(--danger)] touch-manipulation px-3 py-1"
                    >
                      {t('settings.vinyl.communityPackRemove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={recordPlayerAddonUrlRef}
            type="url"
            value={recordPlayerAddonUrl}
            onChange={(e) => onRecordPlayerAddonUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onInstallFromUrl();
            }}
            placeholder={t('settings.vinyl.installUrlPlaceholder')}
            className="input-elevated flex-1 px-4 py-3 text-sm focus-accent"
          />
          <button
            type="button"
            onClick={() => void onInstallFromUrl()}
            disabled={recordPlayerAddonInstalling}
            className="h-11 px-5 rounded-full btn-accent font-mono text-xs font-bold uppercase flex items-center justify-center gap-2 touch-manipulation shrink-0"
          >
            {recordPlayerAddonInstalling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {t('settings.vinyl.installPack')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onBrowseCatalog()}
            disabled={recordPlayerCatalogLoading}
            className="h-10 px-4 rounded-full border font-mono text-xs font-bold uppercase touch-manipulation"
            style={{ borderColor: C.border, color: C.text }}
          >
            {recordPlayerCatalogLoading ? (
              <Loader2 className="w-4 h-4 animate-spin inline" />
            ) : null}{' '}
            {t('settings.vinyl.browseCatalog')}
          </button>
          <button
            type="button"
            onClick={() => void onImportClipboard()}
            className="h-10 px-4 rounded-full border font-mono text-xs font-bold uppercase touch-manipulation"
            style={{ borderColor: C.border, color: C.text }}
          >
            {t('settings.vinyl.importClipboard')}
          </button>
        </div>

        {recordPlayerCatalog && recordPlayerCatalog.length > 0 ? (
          <ul className="space-y-2">
            {recordPlayerCatalog.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]"
              >
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text)] truncate">{entry.name}</p>
                  <p className="text-sm text-[var(--text-mid)]">
                    {t('settings.vinyl.communityPackBy', { author: entry.author })}
                  </p>
                  <p className="ui-hint">{entry.description}</p>
                </div>
                <button
                  type="button"
                  disabled={recordPlayerAddonInstalling}
                  onClick={() => void onInstallCatalogEntry(entry)}
                  className="text-sm font-bold uppercase touch-manipulation px-3 py-1 shrink-0"
                  style={accentStyle}
                >
                  {t('settings.vinyl.installPack')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {recordPlayerAddonStatus ? (
          <p className="ui-hint text-accent">{recordPlayerAddonStatus}</p>
        ) : null}
      </div>
    </div>
  );
}
