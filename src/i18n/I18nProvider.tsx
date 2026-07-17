'use client';

import { useEffect, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ensureI18n, setAppLanguage } from '@/i18n/config';
import { localeToSpeechLang, normalizePreferredLanguage } from '@/lib/i18n/locales';

const i18n = ensureI18n();

interface I18nProviderProps {
  children: ReactNode;
  /** Session preferred language when authenticated. */
  language?: string | null;
  /** Optional callback to sync Web Speech language (from VoiceInputProvider parent). */
  onSpeechLanguageChange?: (bcp47: string) => void;
}

/**
 * Client i18n shell. Locale comes from technician preferredLanguage (default en).
 * Does not use URL-based routing — SPA view state only.
 */
export function I18nProvider({
  children,
  language,
  onSpeechLanguageChange,
}: I18nProviderProps) {
  useEffect(() => {
    const code = normalizePreferredLanguage(language);
    setAppLanguage(code);
    onSpeechLanguageChange?.(localeToSpeechLang(code));
  }, [language, onSpeechLanguageChange]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
