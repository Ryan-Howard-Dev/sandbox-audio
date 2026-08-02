import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  APP_ICONS,
  getActiveAppIcon,
  isAppIconSupported,
  setAppIcon,
  type AppIconKey,
} from '../../appIcon';
import { useTranslation } from '../../i18n';

export interface AppIconPickerProps {
  cardStyle?: React.CSSProperties;
  onError?: (message: string) => void;
}

/**
 * Which launcher icon the app wears.
 *
 * Android only, and absent rather than disabled elsewhere: on desktop the icon belongs to the
 * installer and on the web to the browser, so a greyed-out picker would be promising a choice the
 * platform does not have.
 *
 * The swatches are drawn from the same hexes as the drawables rather than from bitmaps, so adding
 * a fifth icon means one entry in APP_ICONS and one set of vectors, not another four PNGs per
 * density.
 *
 * The warning is not decoration. Android restarts a package whose component enablement changes,
 * and it is far better to say so beforehand than to have the app vanish mid-tap and look broken.
 */
export default function AppIconPicker({ cardStyle, onError }: AppIconPickerProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<AppIconKey>('default');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAppIconSupported()) return;
    void getActiveAppIcon().then(setActive);
  }, []);

  const choose = useCallback(
    async (key: AppIconKey) => {
      if (key === active || busy) return;
      setBusy(true);
      try {
        const result = await setAppIcon(key);
        if (!result.ok) {
          onError?.(t('settings.appearance.iconFailed'));
          return;
        }
        // Optimistic, because the process is usually killed before any state written here
        // survives. On the next launch the picker reads the truth back from the package manager.
        setActive(key);
      } finally {
        setBusy(false);
      }
    },
    [active, busy, onError, t],
  );

  if (!isAppIconSupported()) return null;

  return (
    <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
      <p className="ui-subsection-title">{t('settings.appearance.iconTitle')}</p>
      <p className="ui-hint mt-1">{t('settings.appearance.iconHint')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {APP_ICONS.map((icon) => (
          <button
            key={icon.key}
            type="button"
            onClick={() => void choose(icon.key)}
            disabled={busy}
            aria-pressed={active === icon.key}
            aria-label={t(icon.labelKey)}
            className="flex flex-col items-center gap-2 p-3 border rounded-xl touch-manipulation disabled:opacity-50"
            style={{
              borderColor:
                active === icon.key
                  ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
                  : 'var(--border)',
            }}
          >
            <span
              className="relative w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: icon.background }}
            >
              {/* The mark itself, so the swatch is the icon rather than a colour chip. */}
              <span
                className="font-display text-2xl font-black leading-none"
                style={{ color: icon.foreground }}
                aria-hidden="true"
              >
                S
              </span>
              {active === icon.key ? (
                <Check className="w-3.5 h-3.5 absolute -bottom-1 -right-1 text-accent" />
              ) : null}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]">
              {t(icon.labelKey)}
            </span>
          </button>
        ))}
      </div>

      <p className="ui-hint ui-hint--desc flex items-center gap-2">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : null}
        {t('settings.appearance.iconRestartWarning')}
      </p>
    </div>
  );
}
