import React from 'react';

export interface SettingsGroupProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/** Rounded card grouping rows — Android Settings style on mobile. */
export default function SettingsGroup({ title, children, className = '' }: SettingsGroupProps) {
  return (
    <section className={`settings-group ${className}`.trim()}>
      {title ? <h3 className="settings-group-title">{title}</h3> : null}
      <div className="settings-group-card">{children}</div>
    </section>
  );
}
