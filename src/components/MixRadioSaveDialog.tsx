import React, { useEffect, useMemo, useState } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { useTranslation } from '../i18n';
import type { MixRadioSession } from '../playerMixRadio';
import ModalOverlay from '../stations/ModalOverlay';

export type MixRadioSaveMode = 'playlist' | 'locker';

export interface MixRadioSaveDialogProps {
  open: boolean;
  onClose: () => void;
  session: MixRadioSession | null;
  tracks: MediaEnvelope[];
  onSave: (name: string, mode: MixRadioSaveMode) => void;
  saving?: boolean;
}

export default function MixRadioSaveDialog({
  open,
  onClose,
  session,
  tracks,
  onSave,
  saving = false,
}: MixRadioSaveDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<MixRadioSaveMode>('playlist');

  const defaultName = useMemo(() => {
    if (!session) return '';
    const artist = session.seedArtist.trim() || t('player.unknownArtist');
    return session.kind === 'mix'
      ? t('player.mixRadioSave.defaultMix', { artist })
      : t('player.mixRadioSave.defaultRadio', { artist });
  }, [session, t]);

  useEffect(() => {
    if (!open || !session) return;
    setName(defaultName);
    setMode('playlist');
  }, [open, session, defaultName]);

  if (!session) return null;

  const title =
    session.kind === 'mix'
      ? t('player.mixRadioSave.titleMix')
      : t('player.mixRadioSave.titleRadio');

  return (
    <ModalOverlay open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-mid)]">
          {t('player.mixRadioSave.trackCount', { count: tracks.length })}
        </p>
        <p className="text-sm text-[var(--text-mid)]">{t('player.mixRadioSave.intro')}</p>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('player.mixRadioSave.choiceAria')}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'playlist'}
            className={`save-choice-card touch-manipulation text-left ${mode === 'playlist' ? 'save-choice-card-active' : ''}`}
            onClick={() => setMode('playlist')}
          >
            <span className="save-choice-title">{t('player.mixRadioSave.optionPlaylist')}</span>
            <span className="save-choice-desc">{t('player.mixRadioSave.optionPlaylistDesc')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'locker'}
            className={`save-choice-card touch-manipulation text-left ${mode === 'locker' ? 'save-choice-card-active' : ''}`}
            onClick={() => setMode('locker')}
          >
            <span className="save-choice-title">{t('player.mixRadioSave.optionLocker')}</span>
            <span className="save-choice-desc">{t('player.mixRadioSave.optionLockerDesc')}</span>
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--text-dim)]">
            {mode === 'playlist'
              ? t('player.mixRadioSave.nameLabel')
              : t('player.mixRadioSave.lockerLabel')}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            className="input-elevated w-full h-10 px-3 text-sm border border-[var(--border)] rounded-lg focus-accent"
            aria-label={
              mode === 'playlist'
                ? t('player.mixRadioSave.nameLabel')
                : t('player.mixRadioSave.lockerLabel')
            }
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="px-4 h-10 rounded-lg border border-[var(--border)] text-sm touch-manipulation"
            onClick={onClose}
            disabled={saving}
          >
            {t('player.mixRadioSave.cancel')}
          </button>
          <button
            type="button"
            disabled={tracks.length === 0 || saving}
            className="px-4 h-10 rounded-lg btn-accent text-sm font-semibold disabled:opacity-40 touch-manipulation"
            onClick={() => {
              onSave(name.trim() || defaultName, mode);
            }}
          >
            {saving
              ? t('player.mixRadioSave.saving')
              : mode === 'playlist'
                ? t('player.mixRadioSave.savePlaylist')
                : t('player.mixRadioSave.saveLocker')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
