import React, { useEffect, useState } from 'react';
import ModalOverlay from '../stations/ModalOverlay';
import { useTranslation } from '../i18n';

export interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
}

export default function PromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  label,
  defaultValue = '',
  placeholder,
  submitLabel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <ModalOverlay open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <label className="block space-y-1.5">
        {label ? (
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--text-dim)]">
            {label}
          </span>
        ) : null}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="input-elevated w-full h-10 px-3 text-sm border border-[var(--border)] rounded-lg focus-accent"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onClose();
          }}
        />
      </label>
      <div className="flex gap-2 justify-end pt-6">
        <button
          type="button"
          className="queue-drawer-save-cancel touch-manipulation min-w-[5.5rem]"
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="queue-drawer-save-confirm touch-manipulation min-w-[5.5rem]"
          onClick={handleSubmit}
          disabled={!value.trim()}
        >
          {submitLabel ?? t('common.save')}
        </button>
      </div>
    </ModalOverlay>
  );
}
