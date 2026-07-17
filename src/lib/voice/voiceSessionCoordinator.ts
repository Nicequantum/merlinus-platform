/**
 * C6: Global voice session mutex — only one SpeechRecognition + mic pipeline active app-wide.
 * Prevents multiple VoiceInputButton instances from competing for the microphone.
 */

export interface VoiceSessionHandle {
  stop: () => void;
}

let activeHandle: VoiceSessionHandle | null = null;

/** Stop any other voice session before this service starts listening. */
export function claimVoiceSession(handle: VoiceSessionHandle): void {
  if (activeHandle && activeHandle !== handle) {
    activeHandle.stop();
  }
  activeHandle = handle;
}

export function releaseVoiceSession(handle: VoiceSessionHandle): void {
  if (activeHandle === handle) {
    activeHandle = null;
  }
}