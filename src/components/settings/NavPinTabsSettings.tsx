import React, { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import {
  loadNavPinTabs,
  NAV_PIN_CANDIDATES,
  NAV_PIN_SLOT_COUNT,
  NAV_PINS_CHANGE_EVENT,
  saveNavPinTabs,
  setNavPinTab,
  type NavPinTabId,
} from '../../navPinTabs';
import { useTranslation } from '../../i18n';

const LABEL_KEYS: Record<NavPinTabId, string> = {
  home: 'nav.home',
  locker: 'nav.library',
  discover: 'nav.discover',
  search: 'nav.search',
  podcasts: 'nav.podcasts',
  audiobooks: 'nav.audiobooks',
  settings: 'nav.settings',
};

export default function NavPinTabsSettings() {
  const { t } = useTranslation();
  const [pins, setPins] = useState<NavPinTabId[]>(() => loadNavPinTabs());

  useEffect(() => {
    const sync = () => setPins(loadNavPinTabs());
    window.addEventListener(NAV_PINS_CHANGE_EVENT, sync);
    return () => window.removeEventListener(NAV_PINS_CHANGE_EVENT, sync);
  }, []);

  const handleChange = (slot: number, value: string) => {
    if (!(NAV_PIN_CANDIDATES as readonly string[]).includes(value)) return;
    setPins(setNavPinTab(slot, value as NavPinTabId));
  };

  const handleReset = () => {
    saveNavPinTabs(['home', 'locker', 'search', 'podcasts']);
    setPins(loadNavPinTabs());
  };

  return (
    <section className="nav-pin-settings">
      <div className="nav-pin-settings-head">
        <Pin className="w-4 h-4 text-accent" aria-hidden />
        <div>
          <h3 className="nav-pin-settings-title">{t('settings.navPins.title')}</h3>
          <p className="nav-pin-settings-hint">{t('settings.navPins.hint')}</p>
        </div>
      </div>
      <ol className="nav-pin-settings-slots">
        {Array.from({ length: NAV_PIN_SLOT_COUNT }, (_, slot) => (
          <li key={slot} className="nav-pin-settings-slot">
            <span className="nav-pin-settings-slot-num">{slot + 1}</span>
            <select
              className="nav-pin-settings-select input-elevated"
              value={pins[slot] ?? 'home'}
              aria-label={t('settings.navPins.slotAria', { slot: slot + 1 })}
              onChange={(e) => handleChange(slot, e.target.value)}
            >
              {NAV_PIN_CANDIDATES.map((id) => (
                <option key={id} value={id}>
                  {t(LABEL_KEYS[id])}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      <button type="button" className="nav-pin-settings-reset touch-manipulation" onClick={handleReset}>
        {t('settings.navPins.reset')}
      </button>
    </section>
  );
}
