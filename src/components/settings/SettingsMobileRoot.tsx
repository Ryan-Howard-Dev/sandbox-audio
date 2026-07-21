import React from 'react';
import SettingsGroup from './SettingsGroup';
import SettingsRow from './SettingsRow';

export type SettingsCategoryId =
  | 'fidelity'
  | 'playback'
  | 'vault'
  | 'architect'
  | 'vinyl'
  | 'addons'
  | 'telemetry'
  | 'diagnostics'
  | 'security'
  | 'about';

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  subtitle?: string;
  icon: React.ElementType;
  group: 'general' | 'system' | 'advanced';
}

export interface SettingsMobileRootProps {
  categories: SettingsCategory[];
  onSelect: (id: SettingsCategoryId) => void;
  groupLabels: {
    general: string;
    system: string;
    advanced: string;
  };
  /** Live value on the trailing edge of each row (Spotify / iOS Settings pattern). */
  statusFor?: (id: SettingsCategoryId) => string | undefined;
}

export default function SettingsMobileRoot({
  categories,
  onSelect,
  groupLabels,
  statusFor,
}: SettingsMobileRootProps) {
  const groups: Array<SettingsCategory['group']> = ['general', 'system', 'advanced'];

  return (
    <div className="settings-mobile-root">
      {groups.map((group) => {
        const items = categories.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="settings-mobile-group-wrap">
            <SettingsGroup title={groupLabels[group]}>
              {items.map((cat) => (
                <div key={cat.id} role="presentation">
                  <SettingsRow
                    icon={cat.icon}
                    title={cat.label}
                    subtitle={cat.subtitle}
                    value={statusFor?.(cat.id)}
                    onClick={() => onSelect(cat.id)}
                  />
                </div>
              ))}
            </SettingsGroup>
          </div>
        );
      })}
    </div>
  );
}
