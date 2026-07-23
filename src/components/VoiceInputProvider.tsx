'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useVoiceInput } from '@/hooks/useVoiceInput';

type VoiceInputApi = ReturnType<typeof useVoiceInput>;

const VoiceInputContext = createContext<VoiceInputApi | null>(null);

/** Single app-wide voice pipeline — one mic session shared by all StableTextarea fields. */
export function VoiceInputProvider({
  children,
  speechLanguage,
}: {
  children: ReactNode;
  /** BCP-47 from technician preferred language (e.g. es-US). */
  speechLanguage?: string | null;
}) {
  const voice = useVoiceInput();
  // Stabilize deps — avoid re-binding when the voice API object identity changes.
  const setSpeechLanguage = voice.setSpeechLanguage;

  useEffect(() => {
    if (speechLanguage?.trim()) {
      setSpeechLanguage(speechLanguage.trim());
    }
  }, [speechLanguage, setSpeechLanguage]);

  useEffect(() => {
    const onSpeechLang = (event: Event) => {
      const detail = (event as CustomEvent<{ lang?: string }>).detail;
      if (detail?.lang) setSpeechLanguage(detail.lang);
    };
    window.addEventListener('merlin:speech-language', onSpeechLang);
    return () => window.removeEventListener('merlin:speech-language', onSpeechLang);
  }, [setSpeechLanguage]);

  return <VoiceInputContext.Provider value={voice}>{children}</VoiceInputContext.Provider>;
}

export function useSharedVoiceInput(): VoiceInputApi {
  const voice = useContext(VoiceInputContext);
  if (!voice) {
    throw new Error('useSharedVoiceInput must be used within VoiceInputProvider');
  }
  return voice;
}