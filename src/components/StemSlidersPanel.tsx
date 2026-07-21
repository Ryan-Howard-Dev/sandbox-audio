import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { STEM_KINDS } from '../stemPlaybackEngine';
import type { StemGainState } from '../stemPlaybackEngine';
import type { StemKind } from '../stemSeparation';

const STEM_LABEL_KEYS: Record<StemKind, string> = {
  vocals: 'stems.vocals',
  drums: 'stems.drums',
  bass: 'stems.bass',
  other: 'stems.other',
};

export interface StemSlidersPanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  stemsAvailable: boolean;
  stemsLoading: boolean;
  blocked?: boolean;
  gains: StemGainState;
  onGainChange: (kind: StemKind, db: number, muted: boolean) => void;
}

function StemSlider({
  kind,
  label,
  db,
  muted,
  disabled,
  onChange,
}: {
  kind: StemKind;
  label: string;
  db: number;
  muted: boolean;
  disabled: boolean;
  onChange: (db: number, muted: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-mid)] truncate">
          {label}
        </span>
        <span className="font-mono text-[10px] text-accent shrink-0">
          {muted ? 'MUTE' : `${db > 0 ? '+' : ''}${db}`}
        </span>
      </div>
      <input
        type="range"
        min={-12}
        max={12}
        step={1}
        value={db}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value), muted)}
        className="w-full accent-[var(--accent)]"
        aria-label={label}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(db, !muted)}
        className={`text-[9px] font-mono uppercase py-0.5 rounded border touch-manipulation ${
          muted
            ? 'border-red-500/40 text-red-400'
            : 'border-[var(--border)] text-[var(--text-mid)]'
        }`}
      >
        Mute
      </button>
    </div>
  );
}

export default function StemSlidersPanel({
  enabled,
  onEnabledChange,
  stemsAvailable,
  stemsLoading,
  blocked = false,
  gains,
  onGainChange,
}: StemSlidersPanelProps) {
  const { t } = useTranslation();

  if (blocked) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <p className="text-xs text-[var(--text-mid)]">{t('stems.blockedNative')}</p>
      </div>
    );
  }

  if (stemsLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-mid)] py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('stems.checking')}
      </div>
    );
  }

  if (!stemsAvailable) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-mid)]">{t('stems.notCached')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text)]">
            {t('stems.title')}
          </p>
          <p className="text-[10px] text-[var(--text-mid)] mt-0.5">{t('stems.serverCachedHint')}</p>
        </div>
        <label className="flex items-center gap-2 text-xs touch-manipulation cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          {t('stems.enableMix')}
        </label>
      </div>
      <div className={`grid grid-cols-4 gap-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {STEM_KINDS.map((kind) => (
          <div key={kind}>
            <StemSlider
              kind={kind}
              label={t(STEM_LABEL_KEYS[kind])}
              db={gains[kind].db}
              muted={gains[kind].muted}
              disabled={!enabled}
              onChange={(db, muted) => onGainChange(kind, db, muted)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
