import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  groupByLicence,
  loadAttributions,
  NATIVE_COMPONENTS,
  undeclaredPackages,
  unresolvedComponents,
  type AttributionData,
  type LicenceGroup,
} from '../../attributions';
import { useTranslation } from '../../i18n';

export interface AttributionsCardProps {
  cardStyle?: React.CSSProperties;
}

/**
 * Open source licences, for the software this app is built from.
 *
 * Most of these licences ask for the same thing: keep the notice, pass the licence text on. This
 * is where that happens. Apache-2.0 asks specifically that its NOTICE files be reproduced
 * somewhere third-party notices normally appear, and this is that place.
 *
 * Loaded on demand rather than with the screen. It is about a hundred kilobytes of licence text,
 * and holding it in memory for everyone so that the few people who open this page save a moment is
 * the wrong trade on a phone.
 *
 * Collapsed by default, and deliberately not searchable. Anything that has to be found here is
 * something a person is looking up on purpose, and four hundred package names expanded on arrival
 * would bury the two sections that actually say something.
 */
export default function AttributionsCard({ cardStyle }: AttributionsCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AttributionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expandedLicence, setExpandedLicence] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data || loading) return;
    setLoading(true);
    loadAttributions()
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [open, data, loading]);

  const toggleLicence = useCallback((licence: string) => {
    setExpandedLicence((current) => (current === licence ? null : licence));
  }, []);

  const groups: LicenceGroup[] = data ? groupByLicence(data.packages) : [];
  const undeclared = data ? undeclaredPackages(data.packages) : [];
  const unresolved = unresolvedComponents();

  return (
    <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left touch-manipulation"
        aria-expanded={open}
      >
        <span className="font-mono text-sm font-semibold text-[var(--text)]">
          {t('settings.about.licencesTitle')}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-mid)]" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-mid)]" />
        )}
      </button>
      <p className="ui-hint ui-hint--desc">{t('settings.about.licencesHint')}</p>

      {open ? (
        <div className="space-y-4 pt-1">
          {/*
            The components that arrive through Gradle and a build script rather than npm. They are
            first because they are the large ones and the ones carrying copyleft terms, so a reader
            who stops after the first section has still seen what matters.
          */}
          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-mid)]">
              {t('settings.about.licencesNativeTitle')}
            </p>
            {NATIVE_COMPONENTS.map((component) => (
              <div
                key={component.name}
                className="border border-[var(--border)] rounded-lg p-3 space-y-1"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="font-mono text-xs text-[var(--text)]">{component.name}</span>
                  <span className="font-mono text-[10px] text-[var(--text-mid)]">
                    {component.license}
                    {component.flavour === 'gplay' ? ` · ${t('settings.about.licencesPlayOnly')}` : ''}
                  </span>
                </div>
                <p className="ui-hint ui-hint--desc">{component.role}</p>
                {component.note ? (
                  <p className="ui-hint ui-hint--desc text-[var(--text-mid)] italic">
                    {component.note}
                  </p>
                ) : null}
                <a
                  href={component.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-hint text-accent break-all"
                >
                  {component.url}
                </a>
              </div>
            ))}
          </div>

          {/*
            Unsettled licences, said out loud. The point of this screen is that someone can check
            what they are shipping, and an entry quietly presented as resolved when it is not
            defeats that entirely.
          */}
          {unresolved.length > 0 ? (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-1">
              <p className="font-mono text-xs text-[var(--text)]">
                {t('settings.about.licencesUnresolvedTitle')}
              </p>
              <p className="ui-hint ui-hint--desc">
                {t('settings.about.licencesUnresolvedHint', { count: String(unresolved.length) })}
              </p>
              <ul className="ui-hint ui-hint--desc list-disc pl-4">
                {unresolved.map((component) => (
                  <li key={component.name}>{component.name}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {loading ? (
            <p className="ui-hint ui-hint--desc flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('settings.about.licencesLoading')}
            </p>
          ) : null}

          {failed ? (
            <p className="ui-hint ui-hint--desc">{t('settings.about.licencesFailed')}</p>
          ) : null}

          {data ? (
            <div className="space-y-2">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-mid)]">
                {t('settings.about.licencesPackagesTitle', { count: String(data.packageCount) })}
              </p>

              {undeclared.length > 0 ? (
                <p className="ui-hint ui-hint--desc">
                  {t('settings.about.licencesUndeclared', {
                    names: undeclared.map((p) => p.name).join(', '),
                  })}
                </p>
              ) : null}

              {groups.map((group) => (
                <div key={group.license} className="border border-[var(--border)] rounded-lg">
                  <button
                    type="button"
                    onClick={() => toggleLicence(group.license)}
                    className="w-full flex items-center justify-between gap-2 p-3 text-left touch-manipulation"
                    aria-expanded={expandedLicence === group.license}
                  >
                    <span className="font-mono text-xs text-[var(--text)]">{group.license}</span>
                    <span className="font-mono text-[10px] text-[var(--text-mid)]">
                      {group.packages.length}
                    </span>
                  </button>
                  {expandedLicence === group.license ? (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="ui-hint ui-hint--desc break-words">
                        {group.packages.map((p) => `${p.name}@${p.version}`).join(', ')}
                      </p>
                      {data.licenseTexts[group.license] ? (
                        <pre className="ui-hint p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-void)] overflow-x-auto text-[var(--text-mid)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {data.licenseTexts[group.license]}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}

              {/*
                Reproduced rather than summarised. Apache-2.0 section 4 asks for the NOTICE file
                itself, and a paraphrase is not the file.
              */}
              {Object.keys(data.notices).length > 0 ? (
                <div className="space-y-2 pt-2">
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-mid)]">
                    {t('settings.about.licencesNoticesTitle')}
                  </p>
                  {Object.entries(data.notices).map(([name, text]) => (
                    <div key={name} className="border border-[var(--border)] rounded-lg p-3">
                      <p className="font-mono text-xs text-[var(--text)] mb-1">{name}</p>
                      <pre className="ui-hint overflow-x-auto text-[var(--text-mid)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {text}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
