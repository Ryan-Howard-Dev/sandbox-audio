import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface MobileShellBackButtonProps {
  onClick: () => void;
  /** aria-label override */
  label?: string;
  className?: string;
  /** Burnt orange on light surfaces; white on dark hero overlays. */
  variant?: 'accent' | 'on-dark';
}

export default function MobileShellBackButton({
  onClick,
  label,
  className = '',
  variant = 'accent',
}: MobileShellBackButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`mobile-shell-back touch-manipulation mobile-shell-back--${variant} ${className}`.trim()}
      onClick={onClick}
      aria-label={label ?? t('common.back')}
    >
      <ChevronLeft className="w-6 h-6" aria-hidden />
    </button>
  );
}
