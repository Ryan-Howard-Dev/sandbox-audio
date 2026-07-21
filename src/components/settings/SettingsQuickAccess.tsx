import React from 'react';
import SettingsGroup from './SettingsGroup';
import SettingsToggleRow from './SettingsToggleRow';

export type SettingsQuickNavItem = {
  id: string;
  label: string;
  value: string;
  onOpen: () => void;
};

export interface SettingsQuickAccessProps {
  title: string;
  navItems: SettingsQuickNavItem[];
  gaplessLabel: string;
  gaplessDescription?: string;
  gaplessChecked: boolean;
  onGaplessChange: (checked: boolean) => void;
  crossfadeLabel: string;
  crossfadeDescription?: string;
  crossfadeChecked: boolean;
  onCrossfadeChange: (checked: boolean) => void;
}

/**
 * Top-of-settings shortcuts — current values + common toggles (Spotify Media Quality / Playback pattern).
 */
export default function SettingsQuickAccess({
  title,
  navItems,
  gaplessLabel,
  gaplessDescription,
  gaplessChecked,
  onGaplessChange,
  crossfadeLabel,
  crossfadeDescription,
  crossfadeChecked,
  onCrossfadeChange,
}: SettingsQuickAccessProps) {
  return (
    <div className="settings-quick-access">
      <SettingsGroup title={title}>
        <div className="settings-quick-nav-grid">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="settings-quick-nav-chip touch-manipulation"
              onClick={item.onOpen}
            >
              <span className="settings-quick-nav-chip-label">{item.label}</span>
              <span className="settings-quick-nav-chip-value">{item.value}</span>
            </button>
          ))}
        </div>
        <SettingsToggleRow
          label={gaplessLabel}
          description={gaplessDescription}
          checked={gaplessChecked}
          onChange={onGaplessChange}
        />
        <SettingsToggleRow
          label={crossfadeLabel}
          description={crossfadeDescription}
          checked={crossfadeChecked}
          onChange={onCrossfadeChange}
        />
      </SettingsGroup>
    </div>
  );
}
