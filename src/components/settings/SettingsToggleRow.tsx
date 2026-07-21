import React from 'react';
import SandboxSwitch from '../SandboxSwitch';

export interface SettingsToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

/** Boolean setting row with compact toggle on the right. */
export default function SettingsToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  id,
}: SettingsToggleRowProps) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <p className="settings-row-title">{label}</p>
        {description ? <p className="settings-row-subtitle">{description}</p> : null}
      </div>
      <SandboxSwitch
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        size="compact"
        aria-label={label}
      />
    </div>
  );
}
