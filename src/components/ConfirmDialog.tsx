import React from 'react';
import ModalOverlay from '../stations/ModalOverlay';
import { useTranslation } from '../i18n';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirming?: boolean;
  /** Label while confirm action runs (defaults to common.saving). */
  confirmingLabel?: string;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  confirming = false,
  confirmingLabel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <ModalOverlay open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <p className="text-sm text-[var(--text-mid)] leading-relaxed">{message}</p>
      <div className="flex gap-2 justify-end pt-6">
        <button
          type="button"
          className="queue-drawer-save-cancel touch-manipulation min-w-[5.5rem]"
          onClick={onClose}
          disabled={confirming}
        >
          {cancelLabel ?? t('common.cancel')}
        </button>
        <button
          type="button"
          className={`touch-manipulation min-w-[5.5rem] ${
            danger ? 'confirm-dialog-danger' : 'queue-drawer-save-confirm'
          }`}
          onClick={onConfirm}
          disabled={confirming}
        >
          {confirming
            ? (confirmingLabel ?? t('common.saving'))
            : (confirmLabel ?? t('common.save'))}
        </button>
      </div>
    </ModalOverlay>
  );
}
