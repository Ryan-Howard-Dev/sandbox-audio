import React, { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import {
  loadSovereignUpNextSettings,
  saveSovereignUpNextSettings,
  SOVEREIGN_UP_NEXT_CHANGE_EVENT,
  SOVEREIGN_UP_NEXT_STOP_AFTER_OPTIONS,
  type SovereignUpNextSettings,
} from '../sovereignUpNext';

export default function SovereignUpNextPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SovereignUpNextSettings>(() =>
    loadSovereignUpNextSettings(),
  );

  useEffect(() => {
    const sync = () => setSettings(loadSovereignUpNextSettings());
    window.addEventListener(SOVEREIGN_UP_NEXT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(SOVEREIGN_UP_NEXT_CHANGE_EVENT, sync);
  }, []);

  return (
    <section className="sovereign-up-next-panel" aria-label={t('player.sovereignUpNext.aria')}>
      <div className="sovereign-up-next-panel-head">
        <span className="sovereign-up-next-panel-title">{t('player.sovereignUpNext.title')}</span>
        <label className="sovereign-up-next-toggle ml-auto">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => saveSovereignUpNextSettings({ enabled: e.target.checked })}
            className="sr-only"
          />
          <span
            className={`sovereign-up-next-switch${settings.enabled ? ' sovereign-up-next-switch--on' : ''}`}
            aria-hidden
          />
        </label>
      </div>
      {settings.enabled ? (
        <div className="sovereign-up-next-options">
          <label className="sovereign-up-next-option">
            <input
              type="checkbox"
              checked={settings.unplayedOnly}
              onChange={(e) => saveSovereignUpNextSettings({ unplayedOnly: e.target.checked })}
            />
            <span>{t('player.sovereignUpNext.unplayedOnly')}</span>
          </label>
          <label className="sovereign-up-next-option">
            <input
              type="checkbox"
              checked={settings.insertNewestAtTop}
              onChange={(e) => saveSovereignUpNextSettings({ insertNewestAtTop: e.target.checked })}
            />
            <span>{t('player.sovereignUpNext.insertNewestTop')}</span>
          </label>
          <div className="sovereign-up-next-stop">
            <span className="sovereign-up-next-stop-label">{t('player.sovereignUpNext.stopAfter')}</span>
            <select
              value={settings.stopAfterEpisodes}
              onChange={(e) =>
                saveSovereignUpNextSettings({ stopAfterEpisodes: parseInt(e.target.value, 10) })
              }
              className="sovereign-up-next-stop-select"
              aria-label={t('player.sovereignUpNext.stopAfter')}
            >
              {SOVEREIGN_UP_NEXT_STOP_AFTER_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0
                    ? t('player.sovereignUpNext.stopAfterOff')
                    : t('player.sovereignUpNext.stopAfterN', { count: n })}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <p className="sovereign-up-next-hint">{t('player.sovereignUpNext.hint')}</p>
      )}
    </section>
  );
}
