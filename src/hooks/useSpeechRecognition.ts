'use client';

/**
 * Backward-compatible wrapper around useVoiceInput for legacy imports.
 * Prefer useVoiceInput or VoiceInputService directly for new code.
 */
import { useSharedVoiceInput } from '@/components/VoiceInputProvider';

export function useSpeechRecognition() {
  const voice = useSharedVoiceInput();

  return {
    isListening: voice.isListening,
    isSupported: voice.isSupported && voice.isEnabled,
    toggleListening: voice.toggleListening,
    stopListening: voice.stopListening,
    startListening: voice.startListening,
  };
}