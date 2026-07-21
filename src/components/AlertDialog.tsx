import React from 'react';
import ModalOverlay from '../stations/ModalOverlay';
import { useTranslation } from '../i18n';

export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  okLabel?: string;
}

export default function AlertDialog({
  open,
  onClose,
  title,
  message,
  okLabel,
}: AlertDialogProps) {
  const { t } = useTranslation();

  return (
    <ModalOverlay open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <p className="text-sm text-[var(--text-mid)] leading-relaxed">{message}</p>
      <div className="flex justify-end pt-6">
        <button
          type="button"
          className="queue-drawer-save-confirm touch-manipulation min-w-[5.5rem]"
          onClick={onClose}
        >
          {okLabel ?? t('common.done')}
        </button>
      </div>
    </ModalOverlay>
  );
}
