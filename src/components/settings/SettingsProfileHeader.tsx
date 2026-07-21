import React from 'react';
import { LogOut, User } from 'lucide-react';

export interface SettingsProfileHeaderProps {
  profileName: string;
  onSignOut: () => void;
  profileLabel: string;
  signOutLabel: string;
}

/** Account card at top of mobile settings (Spotify / Apple Music pattern). */
export default function SettingsProfileHeader({
  profileName,
  onSignOut,
  profileLabel,
  signOutLabel,
}: SettingsProfileHeaderProps) {
  return (
    <section className="settings-profile-header" aria-label={profileLabel}>
      <div className="settings-profile-header-card">
        <span className="settings-profile-header-avatar" aria-hidden>
          <User className="w-5 h-5" strokeWidth={2} />
        </span>
        <div className="settings-profile-header-body min-w-0">
          <p className="settings-profile-header-label">{profileLabel}</p>
          <p className="settings-profile-header-name truncate">{profileName}</p>
        </div>
        <button
          type="button"
          className="settings-profile-header-signout touch-manipulation"
          onClick={onSignOut}
          aria-label={signOutLabel}
        >
          <LogOut className="w-4 h-4" strokeWidth={2} aria-hidden />
          <span>{signOutLabel}</span>
        </button>
      </div>
    </section>
  );
}
