import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_PREFERRED_LANGUAGE, normalizePreferredLanguage } from '@/lib/i18n/locales';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enHome from './locales/en/home.json';
import enLine from './locales/en/line.json';
import enStory from './locales/en/story.json';
import enVoice from './locales/en/voice.json';
import enSettings from './locales/en/settings.json';
import enVideo from './locales/en/video.json';
import enRo from './locales/en/ro.json';

import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esHome from './locales/es/home.json';
import esLine from './locales/es/line.json';
import esStory from './locales/es/story.json';
import esVoice from './locales/es/voice.json';
import esSettings from './locales/es/settings.json';
import esVideo from './locales/es/video.json';
import esRo from './locales/es/ro.json';

export const I18N_NAMESPACES = [
  'common',
  'auth',
  'home',
  'line',
  'story',
  'voice',
  'settings',
  'video',
  'ro',
] as const;

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    home: enHome,
    line: enLine,
    story: enStory,
    voice: enVoice,
    settings: enSettings,
    video: enVideo,
    ro: enRo,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    home: esHome,
    line: esLine,
    story: esStory,
    voice: esVoice,
    settings: esSettings,
    video: esVideo,
    ro: esRo,
  },
};

let initialized = false;

export function ensureI18n(): typeof i18n {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: DEFAULT_PREFERRED_LANGUAGE,
      fallbackLng: DEFAULT_PREFERRED_LANGUAGE,
      defaultNS: 'common',
      ns: [...I18N_NAMESPACES],
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    initialized = true;
  }
  return i18n;
}

export function setAppLanguage(language: string | null | undefined): void {
  const code = normalizePreferredLanguage(language);
  const instance = ensureI18n();
  if (instance.language !== code) {
    void instance.changeLanguage(code);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
  }
}

export default ensureI18n();
