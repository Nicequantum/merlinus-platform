import type { SpeechRecognitionErrorCode } from './types';

/** User-facing copy for dealership technicians (shop-floor friendly, not engineering jargon). */
export const VOICE_ERROR_MESSAGES: Record<string, string> = {
  'no-speech': 'No speech heard. Tap the mic or hold push-to-talk and speak closer to the tablet.',
  aborted: 'Voice input stopped.',
  'audio-capture': 'Microphone unavailable. Check that no other app is using the mic.',
  network: 'Voice recognition needs network access. Check Wi‑Fi in the service bay.',
  'not-allowed': 'Microphone blocked. Allow mic access for this site in Chrome or Edge settings.',
  'service-not-allowed': 'Voice recognition is blocked by browser policy. Use manual typing.',
  'bad-grammar': 'Recognition grammar error. Try again or type manually.',
  'language-not-supported': 'Language not supported on this device. Type your notes instead.',
};

export function resolveVoiceErrorMessage(code: SpeechRecognitionErrorCode): string {
  return VOICE_ERROR_MESSAGES[code] ?? 'Voice input error. You can keep typing manually.';
}

/** Benign errors that should trigger a controlled auto-restart in continuous mode. */
export function shouldAutoRestartAfterError(
  code: SpeechRecognitionErrorCode,
  restartCount: number,
  maxRestarts: number
): boolean {
  if (restartCount >= maxRestarts) return false;
  // C7: never auto-restart on 'aborted' — superseded recognizers fire aborted during normal handoff.
  return code === 'no-speech' || code === 'network';
}