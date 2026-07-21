import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface SettingsRowProps {
  icon?: React.ElementType;
  title: string;
  subtitle?: string;
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

/** Navigation row: icon, title, optional subtitle/value, chevron. */
export default function SettingsRow({
  icon: Icon,
  title,
  subtitle,
  value,
  onClick,
  disabled = false,
  children,
}: SettingsRowProps) {
  const interactive = Boolean(onClick) && !disabled;

  const content = (
    <>
      {Icon ? (
        <span className="settings-row-icon" aria-hidden>
          <Icon className="w-5 h-5" />
        </span>
      ) : null}
      <span className="settings-row-body">
        <span className="settings-row-title-row">
          <span className="settings-row-title">{title}</span>
          {value ? <span className="settings-row-value">{value}</span> : null}
        </span>
        {subtitle ? <span className="settings-row-subtitle">{subtitle}</span> : null}
      </span>
      {children ?? (
        interactive ? (
          <ChevronRight className="settings-row-chevron w-5 h-5 shrink-0" aria-hidden />
        ) : null
      )}
    </>
  );

  if (interactive) {
    return (
      <button type="button" className="settings-row" onClick={onClick} disabled={disabled}>
        {content}
      </button>
    );
  }

  return <div className="settings-row settings-row--static">{content}</div>;
}
