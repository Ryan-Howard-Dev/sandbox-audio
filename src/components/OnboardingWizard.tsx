import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Fingerprint,
  FolderOpen,
  Loader2,
  Cast,
  Volume2,
} from 'lucide-react';
import { EXPLORE_GENRES } from '../exploreBrowseData';
import { fetchDeviceIdentity } from '../identityBridge';
import { useTranslation } from '../i18n';
import {
  currentLockerRootPath,
  getLockerRootPlatform,
  persistLockerRootPath,
  pickLockerRootFolder,
  suggestLockerRootPath,
  supportsLockerFolderPicker,
  usesAutomaticLockerStorage,
} from '../lockerRootBridge';
import { isCapacitorNative, isTauri } from '../platformEnv';
import {
  CAST_BROWSER_OPTIONS,
  loadCastBrowserChoice,
  openCastInExternalBrowser,
  saveCastBrowserChoice,
  type CastBrowserChoice,
} from '../castPlatform';
import { applyOnboardingTasteSeeds } from '../tasteProfile';
import { getOnboardingStepIds, type OnboardingStepId } from '../onboardingSteps';
import {
  loadSandboxServerMode,
  saveOnboardingComplete,
  saveOnboardingTasteSeeds,
  saveSandboxServerAutoStart,
  type OnboardingTasteSeeds,
} from '../sandboxSettings';
import { runAndroidPlaybackSelfTest } from '../androidPlaybackSelfTest';
import { isTabletViewport } from '../hooks/mobileShellLayout';
import ServerDiscovery from './ServerDiscovery';

function useTabletOnboardingLayout(): boolean {
  const [tablet, setTablet] = useState(() => isTabletViewport());
  useEffect(() => {
    const sync = () => setTablet(isTabletViewport());
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);
  return tablet;
}

export interface OnboardingWizardProps {
  onComplete: () => void;
  enterAs: (displayName: string) => void;
}

function defaultDisplayName(): string {
  return 'Operator';
}

function OnboardingAppIcon() {
  return (
    <div className="onboarding-hero-icon" aria-hidden="true">
      <img
        src="/icon-desktop.svg"
        alt=""
        className="onboarding-hero-icon-img"
        width={72}
        height={72}
      />
    </div>
  );
}

export default function OnboardingWizard({ onComplete, enterAs }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const lockerPlatform = useMemo(() => getLockerRootPlatform(), []);

  const stepIds = useMemo<OnboardingStepId[]>(
    () => getOnboardingStepIds({ isTauriDesktop: isTauri(), lockerPlatform }),
    [lockerPlatform],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [artistsText, setArtistsText] = useState('');
  const [identity, setIdentity] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [copiedIdentity, setCopiedIdentity] = useState(false);
  const [lockerRootPath, setLockerRootPath] = useState(() => currentLockerRootPath());
  const [lockerBrowseBusy, setLockerBrowseBusy] = useState(false);
  const [castBrowser, setCastBrowser] = useState<CastBrowserChoice>(() => loadCastBrowserChoice());
  const [playbackTestBusy, setPlaybackTestBusy] = useState(false);
  const [playbackTestMessage, setPlaybackTestMessage] = useState<string | null>(null);
  const [playbackTestOk, setPlaybackTestOk] = useState<boolean | null>(null);

  const step = stepIds[stepIndex] ?? 'welcome';
  const isFirst = stepIndex === 0;
  const isLast = stepIndex >= stepIds.length - 1;

  useEffect(() => {
    if (lockerPlatform !== 'tauri' || currentLockerRootPath().trim()) return;
    let cancelled = false;
    void suggestLockerRootPath().then((suggested) => {
      if (!cancelled && suggested) setLockerRootPath(suggested);
    });
    return () => {
      cancelled = true;
    };
  }, [lockerPlatform]);

  useEffect(() => {
    if (step !== 'identity' || !isTauri()) return;
    let cancelled = false;
    setIdentityLoading(true);
    void fetchDeviceIdentity()
      .then((value) => {
        if (!cancelled) setIdentity(value);
      })
      .finally(() => {
        if (!cancelled) setIdentityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };

  const buildTasteSeeds = useCallback((): OnboardingTasteSeeds => {
    const seeds: OnboardingTasteSeeds = { genres: [...selectedGenres] };
    const artists = artistsText.trim();
    if (artists) seeds.artistsFreeText = artists;
    return seeds;
  }, [selectedGenres, artistsText]);

  const persistChoices = useCallback(
    (profileName?: string) => {
      const tasteSeeds = buildTasteSeeds();
      if (tasteSeeds.genres.length > 0 || tasteSeeds.artistsFreeText) {
        saveOnboardingTasteSeeds(tasteSeeds);
        applyOnboardingTasteSeeds(tasteSeeds);
      }

      const mode = loadSandboxServerMode();

      if (mode === 'anchor') {
        saveSandboxServerAutoStart(true);
      }

      if (lockerRootPath.trim()) persistLockerRootPath(lockerRootPath.trim());

      const name = profileName?.trim() || displayName.trim() || defaultDisplayName();
      try {
        enterAs(name);
      } catch {
        /* profile may already exist */
      }

      saveOnboardingComplete(true);
      onComplete();
    },
    [buildTasteSeeds, displayName, enterAs, lockerRootPath, onComplete],
  );

  const browseLockerFolder = async () => {
    setLockerBrowseBusy(true);
    try {
      const picked = await pickLockerRootFolder(lockerRootPath);
      if (picked) setLockerRootPath(picked);
    } finally {
      setLockerBrowseBusy(false);
    }
  };

  const goNext = () => {
    if (isLast) {
      persistChoices();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, stepIds.length - 1));
  };

  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const skipStep = () => goNext();

  const runPlaybackTest = async () => {
    setPlaybackTestBusy(true);
    setPlaybackTestMessage(null);
    setPlaybackTestOk(null);
    try {
      const result = await runAndroidPlaybackSelfTest();
      setPlaybackTestOk(result.ok);
      setPlaybackTestMessage(result.message);
    } finally {
      setPlaybackTestBusy(false);
    }
  };

  const copyIdentity = async () => {
    if (!identity?.trim()) return;
    try {
      await navigator.clipboard.writeText(identity.trim());
      setCopiedIdentity(true);
      window.setTimeout(() => setCopiedIdentity(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const stepLabel = (id: OnboardingStepId) => t(`onboarding.steps.${id}`);

  const lockerPathEditable = supportsLockerFolderPicker();
  const lockerDisplayPath =
    lockerRootPath.trim() ||
    (lockerPlatform === 'web'
      ? t('onboarding.locker.webPathDefault')
      : t('onboarding.locker.mobilePathDefault'));

  const tabletLayout = useTabletOnboardingLayout();

  const wizard = (
    <div
      className={`onboarding-root${tabletLayout ? ' onboarding-root--tablet' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.title')}
    >
      <div className="onboarding-shell music-scrollbar">
        <header className="onboarding-header">
          <p className="onboarding-brand">{t('login.appName')}</p>
          <div className="onboarding-progress" aria-hidden="true">
            {stepIds.map((id, i) => (
              <span
                key={id}
                className={`onboarding-progress-dot${i === stepIndex ? ' onboarding-progress-dot--active' : ''}${i < stepIndex ? ' onboarding-progress-dot--done' : ''}`}
                title={stepLabel(id)}
              />
            ))}
          </div>
          <p className="onboarding-step-label">
            {stepIndex + 1} / {stepIds.length} · {stepLabel(step)}
          </p>
        </header>

        <div className="onboarding-body">
          {step === 'welcome' && (
            <div className="onboarding-panel onboarding-panel--hero">
              <OnboardingAppIcon />
              <h1 className="onboarding-headline">{t('onboarding.welcome.headline')}</h1>
              <p className="onboarding-body-text">
                {isTauri()
                  ? t('onboarding.welcome.desktopBody')
                  : usesAutomaticLockerStorage()
                    ? t('onboarding.welcome.mobileBody')
                    : t('onboarding.welcome.body')}
              </p>
            </div>
          )}

          {step === 'name' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">{t('onboarding.name.title')}</h2>
              <p className="onboarding-hint">{t('onboarding.name.hint')}</p>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('onboarding.name.placeholder')}
                className="onboarding-input"
                autoFocus
                autoComplete="nickname"
              />
            </div>
          )}

          {step === 'taste' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">{t('onboarding.taste.title')}</h2>
              <p className="onboarding-hint">{t('onboarding.taste.hint')}</p>
              <div className="onboarding-chip-grid">
                {EXPLORE_GENRES.map((genre) => {
                  const selected = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleGenre(genre)}
                      className={`onboarding-chip${selected ? ' onboarding-chip--selected' : ''}`}
                    >
                      {genre}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={artistsText}
                onChange={(e) => setArtistsText(e.target.value)}
                placeholder={t('onboarding.taste.artistsPlaceholder')}
                className="onboarding-input mt-4"
              />
            </div>
          )}

          {step === 'locker' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">
                {lockerPathEditable
                  ? t('onboarding.locker.title')
                  : t('onboarding.locker.mobileTitle')}
              </h2>
              <p className="onboarding-hint">
                {lockerPathEditable
                  ? t('onboarding.locker.hint')
                  : t('onboarding.locker.mobileHint')}
              </p>
              {lockerPathEditable ? (
                <>
                  <div className="onboarding-path-row">
                    <input
                      type="text"
                      value={lockerRootPath}
                      onChange={(e) => setLockerRootPath(e.target.value)}
                      placeholder={t('onboarding.locker.pathPlaceholder')}
                      className="onboarding-input"
                      spellCheck={false}
                      aria-label={t('onboarding.locker.pathAria')}
                    />
                    <button
                      type="button"
                      onClick={() => void browseLockerFolder()}
                      disabled={lockerBrowseBusy}
                      className="onboarding-btn onboarding-btn--ghost onboarding-path-browse"
                    >
                      {lockerBrowseBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      {t('onboarding.locker.browse')}
                    </button>
                  </div>
                  <p className="onboarding-footnote">{t('onboarding.locker.desktopFootnote')}</p>
                </>
              ) : (
                <div
                  className="onboarding-option onboarding-option--selected onboarding-locker-auto"
                  role="status"
                  aria-live="polite"
                >
                  <div className="onboarding-locker-auto-row">
                    <FolderOpen className="w-5 h-5 shrink-0 onboarding-accent-icon" aria-hidden="true" />
                    <p className="onboarding-option-title">{lockerDisplayPath}</p>
                  </div>
                  <p className="onboarding-option-hint">{t('onboarding.locker.mobileNote')}</p>
                </div>
              )}
              <p className="onboarding-footnote">{t('onboarding.locker.settingsLater')}</p>
            </div>
          )}

          {step === 'server' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">
                {isCapacitorNative()
                  ? t('onboarding.server.titleMobile')
                  : t('onboarding.server.title')}
              </h2>
              <p className="onboarding-hint">
                {isCapacitorNative()
                  ? t('onboarding.server.hintMobile')
                  : t('onboarding.server.hint')}
              </p>
              <ServerDiscovery variant="onboarding" showSubsections={false} />
              <p className="onboarding-footnote">{t('onboarding.server.settingsLater')}</p>
            </div>
          )}

          {step === 'playback' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">{t('onboarding.playback.title')}</h2>
              <p className="onboarding-hint">{t('onboarding.playback.hint')}</p>
              <button
                type="button"
                onClick={() => void runPlaybackTest()}
                disabled={playbackTestBusy}
                className="onboarding-btn onboarding-btn--primary inline-flex items-center gap-2 mt-4"
              >
                {playbackTestBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
                {playbackTestBusy
                  ? t('onboarding.playback.testing')
                  : t('onboarding.playback.runTest')}
              </button>
              {playbackTestMessage ? (
                <p
                  className={`onboarding-footnote mt-3${playbackTestOk ? ' text-accent' : ''}`}
                  role="status"
                >
                  {playbackTestOk
                    ? t('onboarding.playback.success')
                    : playbackTestMessage || t('onboarding.playback.failed')}
                </p>
              ) : null}
              <p className="onboarding-footnote mt-3">{t('onboarding.playback.skipHint')}</p>
            </div>
          )}

          {step === 'cast' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">{t('onboarding.cast.title')}</h2>
              <div className="onboarding-option onboarding-option--selected mt-3">
                <p className="onboarding-option-title">{t('onboarding.cast.dlnaTitle')}</p>
                <p className="onboarding-option-hint">{t('onboarding.cast.dlnaHint')}</p>
              </div>
              <div className="mt-4 space-y-2">
                <p className="onboarding-option-title">{t('onboarding.cast.chromecastTitle')}</p>
                <p className="onboarding-hint">{t('onboarding.cast.chromecastHint')}</p>
                <label className="block mt-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-dim)]">
                  {t('onboarding.cast.browserLabel')}
                  <select
                    value={castBrowser}
                    onChange={(e) => {
                      const next = e.target.value as CastBrowserChoice;
                      setCastBrowser(next);
                      saveCastBrowserChoice(next);
                    }}
                    className="mt-1 w-full onboarding-input normal-case tracking-normal text-[11px]"
                  >
                    {CAST_BROWSER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void openCastInExternalBrowser({ browser: castBrowser })}
                  className="onboarding-btn onboarding-btn--primary inline-flex items-center gap-2 mt-1"
                >
                  <Cast className="w-4 h-4" />
                  {t('onboarding.cast.openBrowser')}
                </button>
              </div>
              <p className="onboarding-footnote">{t('onboarding.cast.settingsLater')}</p>
            </div>
          )}

          {step === 'identity' && (
            <div className="onboarding-panel">
              <h2 className="onboarding-title">{t('onboarding.identity.title')}</h2>
              <p className="onboarding-hint">{t('onboarding.identity.hint')}</p>
              <div className="onboarding-identity-card">
                <Fingerprint className="w-5 h-5 shrink-0 onboarding-accent-icon" aria-hidden="true" />
                {identityLoading ? (
                  <span className="onboarding-identity-loading">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('onboarding.identity.loading')}
                  </span>
                ) : identity ? (
                  <code className="onboarding-identity-value">{identity}</code>
                ) : (
                  <span className="onboarding-hint">{t('onboarding.identity.unavailable')}</span>
                )}
              </div>
              {identity ? (
                <button type="button" onClick={() => void copyIdentity()} className="onboarding-copy-btn">
                  <Copy className="w-4 h-4" />
                  {copiedIdentity ? t('onboarding.identity.copied') : t('onboarding.identity.copy')}
                </button>
              ) : null}
            </div>
          )}

          {step === 'finish' && (
            <div className="onboarding-panel onboarding-panel--hero">
              <OnboardingAppIcon />
              <h1 className="onboarding-headline">{t('onboarding.finish.headline')}</h1>
              <p className="onboarding-body-text">
                {isCapacitorNative()
                  ? t('onboarding.finish.bodyMobile')
                  : t('onboarding.finish.body')}
              </p>
            </div>
          )}
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-footer-start">
            {!isFirst ? (
              <button type="button" onClick={goBack} className="onboarding-btn onboarding-btn--ghost">
                <ChevronLeft className="w-4 h-4" />
                {t('common.back')}
              </button>
            ) : null}
          </div>
          <div className="onboarding-footer-actions">
            {!isLast ? (
              <button type="button" onClick={skipStep} className="onboarding-btn onboarding-btn--ghost">
                {t('common.skip')}
              </button>
            ) : null}
            <button type="button" onClick={goNext} className="onboarding-btn onboarding-btn--primary">
              {isLast ? t('onboarding.finish.enterHome') : t('common.next')}
              {!isLast ? <ChevronRight className="w-4 h-4" /> : null}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return wizard;
}
