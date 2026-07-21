import React, { useState } from 'react';
import { Cast, X } from 'lucide-react';
import {
  CAST_BROWSER_OPTIONS,
  loadCastBrowserChoice,
  openCastInExternalBrowser,
  saveCastBrowserChoice,
  type CastBrowserChoice,
} from '../castPlatform';
import { useTranslation } from '../i18n';
import {
  loadTauriCastGuidanceDismissed,
  saveTauriCastGuidanceDismissed,
} from '../sandboxSettings';

export interface TauriCastGuidancePanelProps {
  className?: string;
  onDismiss?: () => void;
}

/** Dismissible Chromecast guidance for Tauri desktop — only mount in Cast/Settings contexts. */
export default function TauriCastGuidancePanel({
  className = '',
  onDismiss,
}: TauriCastGuidancePanelProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(loadTauriCastGuidanceDismissed);
  const [browser, setBrowser] = useState<CastBrowserChoice>(() => loadCastBrowserChoice());

  if (dismissed) return null;

  const handleDismiss = () => {
    saveTauriCastGuidanceDismissed(true);
    setDismissed(true);
    onDismiss?.();
  };

  const handleBrowserChange = (next: CastBrowserChoice) => {
    setBrowser(next);
    saveCastBrowserChoice(next);
  };

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 ${className}`.trim()}
    >
      <div className="flex-1 space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-wide font-semibold text-[var(--text)]">
          {t('shell.tauriCastBannerTitle')}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-dim)] leading-relaxed">
          {t('shell.tauriCastBanner')}
        </p>
        <label className="mt-2 block font-mono text-[9px] uppercase tracking-wider text-[var(--text-dim)]">
          {t('shell.castBrowserLabel')}
          <select
            value={browser}
            onChange={(e) => handleBrowserChange(e.target.value as CastBrowserChoice)}
            className="mt-1 w-full font-mono text-[9px] uppercase tracking-wider bg-[var(--surface)] border border-accent/30 rounded px-2 py-1.5 text-[var(--text)]"
          >
            {CAST_BROWSER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <p className="font-mono text-[8px] normal-case tracking-normal text-[var(--text-dim)] leading-relaxed">
          {t('shell.castBrowserChromecastNote')}
        </p>
        <button
          type="button"
          onClick={() => void openCastInExternalBrowser({ browser })}
          className="mt-2 font-mono text-[9px] uppercase tracking-wider text-accent touch-manipulation px-2 py-1 border border-accent/40 rounded inline-flex items-center gap-1"
        >
          <Cast className="w-3 h-3" />
          {t('shell.tauriCastBannerOpen')}
        </button>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 w-8 h-8 flex items-center justify-center touch-manipulation text-[var(--text-dim)] hover:text-accent"
        aria-label={t('shell.tauriCastBannerDismiss')}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
