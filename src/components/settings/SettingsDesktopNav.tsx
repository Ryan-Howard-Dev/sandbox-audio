import React from 'react';
import type { SettingsCategory } from './SettingsMobileRoot';

export type SettingsTabId = SettingsCategory['id'];

export interface SettingsDesktopNavProps {
  categories: SettingsCategory[];
  activeTab: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
  groupLabels: {
    general: string;
    system: string;
    advanced: string;
  };
  statusFor: (id: SettingsTabId) => string | undefined;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  advancedToggleLabel: string;
}

const ADVANCED_NESTED_IDS = new Set<SettingsTabId>(['telemetry', 'diagnostics']);

/** Grouped sidebar — General / Connected / Security + collapsible Signal Bench (Spotify tablet pattern). */
export default function SettingsDesktopNav({
  categories,
  activeTab,
  onSelect,
  groupLabels,
  statusFor,
  advancedOpen,
  onAdvancedOpenChange,
  advancedToggleLabel,
}: SettingsDesktopNavProps) {
  const groups: Array<SettingsCategory['group']> = ['general', 'system', 'advanced'];

  const renderTab = (cat: SettingsCategory) => {
    const Icon = cat.icon;
    const active = activeTab === cat.id;
    const status = statusFor(cat.id);
    return (
      <button
        key={cat.id}
        type="button"
        onClick={() => onSelect(cat.id)}
        aria-current={active ? 'page' : undefined}
        className={`settings-tab touch-manipulation${active ? ' settings-tab-active' : ''}`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="settings-desktop-nav-label">{cat.label}</span>
        {status ? <span className="settings-desktop-nav-status">{status}</span> : null}
      </button>
    );
  };

  return (
    <nav className="settings-desktop-nav" aria-label="Settings sections">
      {groups.map((group) => {
        const items = categories.filter((c) => c.group === group);
        if (items.length === 0) return null;

        if (group === 'advanced') {
          const topLevel = items.filter((c) => !ADVANCED_NESTED_IDS.has(c.id));
          const nested = items.filter((c) => ADVANCED_NESTED_IDS.has(c.id));
          const nestedActive = nested.some((c) => c.id === activeTab);

          return (
            <div key={group} className="settings-desktop-nav-group">
              <p className="settings-desktop-nav-group-title">{groupLabels.advanced}</p>
              {topLevel.map(renderTab)}
              {nested.length > 0 ? (
                <div className="settings-tab-advanced-wrap">
                  <button
                    type="button"
                    className={`settings-tab settings-tab-advanced settings-desktop-nav-advanced-toggle touch-manipulation${
                      nestedActive ? ' settings-tab-active' : ''
                    }`}
                    onClick={() => onAdvancedOpenChange(!advancedOpen)}
                    aria-expanded={advancedOpen}
                  >
                    {advancedToggleLabel}
                  </button>
                  {advancedOpen ? (
                    <div className="settings-tab-advanced-children settings-desktop-nav-nested">
                      {nested.map((cat) => {
                        const Icon = cat.icon;
                        const active = activeTab === cat.id;
                        const status = statusFor(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => onSelect(cat.id)}
                            aria-current={active ? 'page' : undefined}
                            className={`settings-tab settings-tab-nested touch-manipulation${
                              active ? ' settings-tab-active' : ''
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="settings-desktop-nav-label">{cat.label}</span>
                            {status ? (
                              <span className="settings-desktop-nav-status">{status}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <div key={group} className="settings-desktop-nav-group">
            <p className="settings-desktop-nav-group-title">{groupLabels[group]}</p>
            {items.map(renderTab)}
          </div>
        );
      })}
    </nav>
  );
}
