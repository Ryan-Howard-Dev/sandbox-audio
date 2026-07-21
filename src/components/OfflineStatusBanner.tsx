import React from 'react';

import { useTranslation } from '../i18n';

export interface OfflineStatusBannerProps {
  message: string;
  /** When set, shown as a short uppercase label before the message. */
  label?: string;
  className?: string;
}

/**
 * Inline offline / degraded-service notice — matches locker and feed empty-state typography.
 */
export default function OfflineStatusBanner({
  message,
  label,
  className = '',
}: OfflineStatusBannerProps) {
  const { t } = useTranslation();
  const displayLabel = label ?? t('offline.label');
  return (
    <p
      className={`font-mono text-[10px] uppercase tracking-wide text-[var(--text-dim)] border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg)]/60 ${className}`.trim()}
      role="status"
    >
      <span className="text-accent font-bold">{displayLabel}</span>
      <span className="text-[var(--text-dim)]"> — </span>
      {message}
    </p>
  );
}
