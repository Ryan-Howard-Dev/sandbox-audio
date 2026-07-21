/**
 * UI language preference — persisted via prefsStorage.
 * Drives document lang/dir (RTL for Arabic) and i18n via sandbox-language-change.
 */

import { useEffect, useState } from 'react';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const LANGUAGE_KEY = 'sandbox_language';

export type AppLanguage =
  | 'en'
  | 'zh'
  | 'es'
  | 'pt'
  | 'ar'
  | 'ru'
  | 'de'
  | 'fr'
  | 'ja'
  | 'ko'
  | 'hi'
  | 'id'
  | 'tr'
  | 'it'
  | 'nl'
  | 'pl'
  | 'vi'
  | 'th'
  | 'bn';

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  id: AppLanguage;
  label: string;
  nativeLabel: string;
}> = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'zh', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { id: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { id: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { id: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
  { id: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { id: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { id: 'fr', label: 'French', nativeLabel: 'Français' },
  { id: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { id: 'ko', label: 'Korean', nativeLabel: '한국어' },
  { id: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { id: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
  { id: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { id: 'it', label: 'Italian', nativeLabel: 'Italiano' },
  { id: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
  { id: 'pl', label: 'Polish', nativeLabel: 'Polski' },
  { id: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
  { id: 'th', label: 'Thai', nativeLabel: 'ไทย' },
  { id: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
];

const VALID_LANGUAGES = new Set<string>(LANGUAGE_OPTIONS.map((o) => o.id));

const RTL_LANGUAGES = new Set<AppLanguage>(['ar']);

export function isAppLanguage(value: string): value is AppLanguage {
  return VALID_LANGUAGES.has(value);
}

export function loadLanguage(): AppLanguage {
  const saved = prefsGetItem(LANGUAGE_KEY);
  if (saved && isAppLanguage(saved)) return saved;
  return DEFAULT_LANGUAGE;
}

export function applyDocumentLanguage(lang: AppLanguage = loadLanguage()): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  }
}

export function saveLanguage(lang: AppLanguage): void {
  prefsSetItem(LANGUAGE_KEY, lang);
  applyDocumentLanguage(lang);
  window.dispatchEvent(new Event('sandbox-language-change'));
}

export function initLanguage(): AppLanguage {
  const lang = loadLanguage();
  applyDocumentLanguage(lang);
  return lang;
}

/** Subscribe to persisted language for future translated strings. */
export function useLanguage(): AppLanguage {
  const [lang, setLang] = useState<AppLanguage>(() => loadLanguage());

  useEffect(() => {
    const onChange = () => setLang(loadLanguage());
    window.addEventListener('sandbox-language-change', onChange);
    return () => window.removeEventListener('sandbox-language-change', onChange);
  }, []);

  return lang;
}
