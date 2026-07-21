import React from 'react';
import { Bell } from 'lucide-react';

export interface NotificationBellButtonProps {
  count: number;
  onClick: () => void;
  ariaLabel: string;
  className?: string;
}

/** In-station bell for unseen release / podcast episode counts. */
export default function NotificationBellButton({
  count,
  onClick,
  ariaLabel,
  className = '',
}: NotificationBellButtonProps) {
  if (count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);
  return (
    <button
      type="button"
      className={`notification-bell-btn touch-manipulation ${className}`.trim()}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <Bell className="w-4 h-4" aria-hidden />
      <span className="notification-bell-badge font-mono tabular-nums" aria-hidden>
        {label}
      </span>
    </button>
  );
}
