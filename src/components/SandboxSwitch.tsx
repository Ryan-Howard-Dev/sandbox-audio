import React from 'react';

export interface SandboxSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  id?: string;
  disabled?: boolean;
  size?: 'default' | 'compact';
  'aria-label'?: string;
  'data-testid'?: string;
}

/** Standard horizontal pill toggle — brand orange on, dark grey off. */
export default function SandboxSwitch({
  checked,
  onChange,
  label,
  description,
  id,
  disabled = false,
  size = 'default',
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: SandboxSwitchProps) {
  const switchId = id ?? `sandbox-switch-${label?.replace(/\s/g, '-') ?? 'toggle'}`;
  const compact = size === 'compact';

  return (
    <div
      className={`flex items-center justify-between gap-4${
        compact || label || description ? ' sandbox-switch-wrap' : ''
      }${compact ? ' sandbox-switch-wrap--compact' : ''}`}
    >
      {(label || description) && (
        <div className="min-w-0 flex-1">
          {label && (
            <p className="font-semibold text-[var(--text)]" id={`${switchId}-label`}>
              {label}
            </p>
          )}
          {description && (
            <p className="mt-0.5 text-[var(--text-mid)] leading-snug">{description}</p>
          )}
        </div>
      )}
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        aria-labelledby={label ? `${switchId}-label` : undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        aria-label={ariaLabel ?? label}
        data-testid={dataTestId}
        className={`sandbox-switch ${
          compact ? 'sandbox-switch--compact' : 'sandbox-switch--default'
        } ${checked ? 'sandbox-switch--on' : 'sandbox-switch--off'}`}
      >
        <span className="sandbox-switch-thumb" aria-hidden />
      </button>
    </div>
  );
}
