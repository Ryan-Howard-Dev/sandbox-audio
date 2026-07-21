import React from 'react';
import { ChevronRight } from 'lucide-react';
import ServerDiscovery from './ServerDiscovery';
import { useTranslation } from '../i18n';
import {
  loadSandboxServerMode,
  loadSandboxServerRemoteUrl,
  saveSandboxServerMode,
  saveServerSetupComplete,
} from '../sandboxSettings';

export interface ServerSetupProps {
  onComplete: () => void;
}

export default function ServerSetup({ onComplete }: ServerSetupProps) {
  const { t } = useTranslation();

  const skipLockerOnly = () => {
    saveSandboxServerMode('off');
    saveServerSetupComplete(true);
    onComplete();
  };

  const finish = () => {
    const mode = loadSandboxServerMode();
    const hasUrl = loadSandboxServerRemoteUrl().trim().length > 0;
    if (mode === 'off' || mode === 'anchor' || hasUrl) {
      saveServerSetupComplete(true);
      onComplete();
    }
  };

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-label={t('serverSetup.title')}>
      <div className="onboarding-shell music-scrollbar">
        <header className="onboarding-header">
          <p className="onboarding-brand">{t('login.appName')}</p>
          <p className="onboarding-step-label">{t('serverSetup.stepLabel')}</p>
        </header>

        <div className="onboarding-body">
          <div className="onboarding-panel">
            <h2 className="onboarding-title">{t('serverSetup.title')}</h2>
            <p className="onboarding-hint">{t('serverSetup.hint')}</p>
            <ServerDiscovery variant="setup" showSubsections={false} onModeApplied={() => undefined} />
          </div>
        </div>

        <footer className="onboarding-footer">
          <button type="button" onClick={skipLockerOnly} className="onboarding-btn onboarding-btn--ghost">
            {t('serverSetup.skipLockerOnly')}
          </button>
          <button
            type="button"
            onClick={finish}
            className="onboarding-btn onboarding-btn--primary inline-flex items-center gap-2"
          >
            {t('serverSetup.continue')}
            <ChevronRight className="w-4 h-4" />
          </button>
        </footer>
      </div>
    </div>
  );
}
