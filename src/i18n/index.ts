/**
 * Lightweight i18n — keyed JSON locales with English fallback.
 * Non-English locales load on demand to keep initial bundles small.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLanguage, type AppLanguage, DEFAULT_LANGUAGE } from '../languageSettings';
import en from './locales/en.json';

export type TranslationDict = typeof en;

/** Partial locale JSON — runtime `t()` falls back to English for missing keys. */
const asLocale = (dict: object): TranslationDict => dict as unknown as TranslationDict;

const localeCache: Partial<Record<AppLanguage, TranslationDict>> = {
  en,
};

const localeLoaders: Record<AppLanguage, () => Promise<{ default: object }>> = {
  en: () => Promise.resolve({ default: en }),
  zh: () => import('./locales/zh.json'),
  es: () => import('./locales/es.json'),
  pt: () => import('./locales/pt.json'),
  ar: () => import('./locales/ar.json'),
  ru: () => import('./locales/ru.json'),
  de: () => import('./locales/de.json'),
  fr: () => import('./locales/fr.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  hi: () => import('./locales/hi.json'),
  id: () => import('./locales/id.json'),
  tr: () => import('./locales/tr.json'),
  it: () => import('./locales/it.json'),
  nl: () => import('./locales/nl.json'),
  pl: () => import('./locales/pl.json'),
  vi: () => import('./locales/vi.json'),
  th: () => import('./locales/th.json'),
  bn: () => import('./locales/bn.json'),
};

function getDict(lang: AppLanguage): TranslationDict {
  return localeCache[lang] ?? en;
}

/** Load a locale JSON file if not already cached (English is always sync). */
export async function preloadLocale(lang: AppLanguage): Promise<void> {
  if (localeCache[lang]) return;
  const mod = await localeLoaders[lang]();
  localeCache[lang] = asLocale(mod.default);
}

export type TranslationParams = Record<string, string | number>;

function resolveNested(dict: TranslationDict, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as object))) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    text,
  );
}

/** Minimal ICU plural — `{count, plural, one {# play} other {# plays}}`. */
function formatIcuPlural(text: string, params: TranslationParams): string {
  const match = text.match(
    /^\{(\w+),\s*plural,\s*one\s*\{([^}]+)\}\s*other\s*\{([^}]+)\}\s*\}$/,
  );
  if (!match) return text;
  const [, key, oneTpl, otherTpl] = match;
  const count = Number(params[key] ?? 0);
  const tpl = count === 1 ? oneTpl : otherTpl;
  return tpl.replace(/#/g, String(count));
}

/** Translate a dot-notation key; falls back to English then the key itself. */
export function t(
  key: string,
  lang: AppLanguage = DEFAULT_LANGUAGE,
  params?: TranslationParams,
): string {
  const dict = getDict(lang);
  const raw = resolveNested(dict, key) ?? resolveNested(en, key) ?? key;
  const pluralized = params ? formatIcuPlural(raw, params) : raw;
  return interpolate(pluralized, params);
}

/** React hook — re-renders on sandbox-language-change and when async locales load. */
export function useTranslation() {
  const lang = useLanguage();
  const [localeTick, setLocaleTick] = useState(0);

  useEffect(() => {
    if (lang === 'en' || localeCache[lang]) return;
    let cancelled = false;
    void preloadLocale(lang).then(() => {
      if (!cancelled) setLocaleTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return useMemo(
    () => ({
      lang,
      t: (key: string, params?: TranslationParams) => t(key, lang, params),
    }),
    [lang, localeTick],
  );
}

/** Count leaf string keys in a locale (for diagnostics). */
export function countLocaleKeys(dict: TranslationDict = en): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      count += 1;
      return;
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(dict);
  return count;
}
