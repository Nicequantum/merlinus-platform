/**
 * App locale allowlist — UI, voice STT, and story input-language hints.
 * Extensible: add code + speech map + message catalogs for new languages.
 */

export const DEFAULT_PREFERRED_LANGUAGE = 'en' as const;

/** Phase 1 supported UI languages. */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

export type PreferredLanguage = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<PreferredLanguage, string> = {
  en: 'English',
  es: 'Español',
};

/** English display names for story prompts (always English instructions to the model). */
export const LOCALE_ENGLISH_NAMES: Record<PreferredLanguage, string> = {
  en: 'English',
  es: 'Spanish',
};

/** Web Speech API BCP-47 tags per app locale. */
export const LOCALE_SPEECH_LANG: Record<PreferredLanguage, string> = {
  en: 'en-US',
  es: 'es-US',
};

export function isPreferredLanguage(value: unknown): value is PreferredLanguage {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizePreferredLanguage(value: unknown): PreferredLanguage {
  if (isPreferredLanguage(value)) return value;
  return DEFAULT_PREFERRED_LANGUAGE;
}

export function localeToSpeechLang(locale: string | null | undefined): string {
  const code = normalizePreferredLanguage(locale);
  return LOCALE_SPEECH_LANG[code];
}

export function preferredLanguageEnglishName(locale: string | null | undefined): string {
  return LOCALE_ENGLISH_NAMES[normalizePreferredLanguage(locale)];
}
