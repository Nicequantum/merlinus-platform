'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_INPUT_SETTINGS } from '@/lib/constants';
import {
  VoiceInputService,
  isSpeechRecognitionSupported,
  type TranscriptMeta,
  type VoiceDictationMode,
  type VoiceInputMode,
  type VoiceInputStartOptions,
  type VoiceInputState,
} from '@/lib/voice';

export type VoiceListenOptions = VoiceInputStartOptions;

const MODE_STORAGE_KEY = VOICE_INPUT_SETTINGS.modeStorageKey;

function readStoredMode(): VoiceInputMode {
  if (typeof window === 'undefined') return VOICE_INPUT_SETTINGS.pushToTalkDefault ? 'push-to-talk' : 'toggle';
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'push-to-talk' || stored === 'toggle') return stored;
  } catch {
    // private browsing / blocked storage
  }
  return VOICE_INPUT_SETTINGS.pushToTalkDefault ? 'push-to-talk' : 'toggle';
}

function writeStoredMode(mode: VoiceInputMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function useVoiceInput() {
  const serviceRef = useRef<VoiceInputService | null>(null);
  const activeTargetRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const onTranscriptRef = useRef<((value: string, meta?: TranscriptMeta) => void) | null>(null);
  const listenOptionsRef = useRef<VoiceInputStartOptions>({});
  const [activeTarget, setActiveTarget] = useState<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const [state, setState] = useState<VoiceInputState>(() => ({
    listeningState: 'idle',
    isListening: false,
    isSupported: typeof window !== 'undefined' && isSpeechRecognitionSupported(),
    permission: 'unknown',
    mode: readStoredMode(),
    noiseLevel: 0,
    confidence: null,
    confidenceThreshold: VOICE_INPUT_SETTINGS.baseConfidenceThreshold,
    interimText: '',
    committedText: '',
    restartCount: 0,
    errorMessage: null,
    errorCode: null,
  }));

  useEffect(() => {
    const service = new VoiceInputService({ ...VOICE_INPUT_SETTINGS });
    service.setMode(readStoredMode());
    serviceRef.current = service;
    void service.refreshPermission();

    // M17: release mic when tab is hidden or page unloads.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') service.stop();
    };
    const onPageHide = () => service.destroy();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      service.destroy();
      serviceRef.current = null;
    };
  }, []);

  const setSpeechLanguage = useCallback((language: string) => {
    serviceRef.current?.setLanguage(language);
  }, []);

  const startListening = useCallback(
    (
      target: HTMLTextAreaElement | HTMLInputElement,
      onTranscript: (value: string, meta?: TranscriptMeta) => void,
      options?: VoiceInputStartOptions
    ): boolean => {
      if (!VOICE_INPUT_SETTINGS.enabled) return false;
      const service = serviceRef.current;
      if (!service) return false;

      const listenOptions = options ?? {};
      activeTargetRef.current = target;
      onTranscriptRef.current = onTranscript;
      listenOptionsRef.current = listenOptions;
      setActiveTarget(target);

      void service.start(
        target,
        {
          onTranscript: (full, meta) => onTranscript(full, meta),
          onStateChange: (next) => {
            setState(next);
            if (!next.isListening) {
              activeTargetRef.current = null;
              setActiveTarget(null);
            }
          },
        },
        listenOptions
      );
      return true;
    },
    []
  );

  const stopListening = useCallback(() => {
    serviceRef.current?.stop();
    activeTargetRef.current = null;
    setActiveTarget(null);
    setState((prev) => ({
      ...prev,
      isListening: false,
      listeningState: 'idle',
      interimText: '',
    }));
  }, []);

  const toggleListening = useCallback(
    (
      target: HTMLTextAreaElement | HTMLInputElement,
      onTranscript: (value: string, meta?: TranscriptMeta) => void,
      options?: VoiceInputStartOptions
    ) => {
      if (state.isListening && activeTargetRef.current === target) {
        stopListening();
        return;
      }
      if (state.isListening) {
        stopListening();
      }
      startListening(target, onTranscript, options);
    },
    [state.isListening, startListening, stopListening]
  );

  const beginPushToTalk = useCallback(
    (
      target: HTMLTextAreaElement | HTMLInputElement,
      onTranscript: (value: string, meta?: TranscriptMeta) => void,
      options?: VoiceInputStartOptions
    ) => {
      if (!state.isListening) startListening(target, onTranscript, options);
    },
    [state.isListening, startListening]
  );

  const endPushToTalk = useCallback(() => {
    if (state.isListening) stopListening();
  }, [state.isListening, stopListening]);

  const setMode = useCallback((mode: VoiceInputMode) => {
    writeStoredMode(mode);
    serviceRef.current?.setMode(mode);
    setState((prev) => ({ ...prev, mode }));
    if (mode === 'push-to-talk' && state.isListening) stopListening();
  }, [state.isListening, stopListening]);

  const retry = useCallback(async () => {
    const service = serviceRef.current;
    if (!service || !activeTargetRef.current || !onTranscriptRef.current) return false;
    return service.retry(listenOptionsRef.current);
  }, []);

  const refreshPermission = useCallback(async () => {
    return serviceRef.current?.refreshPermission() ?? 'unknown';
  }, []);

  return {
    ...state,
    activeTarget,
    isEnabled: VOICE_INPUT_SETTINGS.enabled,
    settings: VOICE_INPUT_SETTINGS,
    startListening,
    stopListening,
    toggleListening,
    beginPushToTalk,
    endPushToTalk,
    setMode,
    setSpeechLanguage,
    retry,
    refreshPermission,
  };
}