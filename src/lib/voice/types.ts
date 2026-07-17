/** Shared types for Merlin voice input (Web Speech API + Web Audio noise monitoring). */

export type VoiceInputMode = 'toggle' | 'push-to-talk';

export type VoicePermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

export type VoiceListeningState =
  | 'idle'
  | 'requesting-permission'
  | 'listening'
  | 'restarting'
  | 'timeout'
  | 'error'
  | 'unsupported';

export type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported'
  | string;

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: SpeechRecognitionErrorCode; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export interface TranscriptMeta {
  /** Text committed from finalized recognition segments. */
  committed: string;
  /** Current interim (non-final) segment. */
  interim: string;
  /** Combined value suitable for writing into the target field. */
  full: string;
  /** Whether the latest event included a finalized segment. */
  hasFinal: boolean;
  /** Best confidence from the latest result batch (0–1), when exposed by the browser. */
  confidence: number | null;
}

export interface VoiceInputState {
  listeningState: VoiceListeningState;
  isListening: boolean;
  isSupported: boolean;
  permission: VoicePermissionState;
  mode: VoiceInputMode;
  noiseLevel: number;
  confidence: number | null;
  confidenceThreshold: number;
  interimText: string;
  committedText: string;
  restartCount: number;
  errorMessage: string | null;
  errorCode: SpeechRecognitionErrorCode | null;
}

export interface VoiceInputTargetContext {
  prefix: string;
  suffix: string;
  committed: string;
  selectionStart: number;
  selectionEnd: number;
}

export type VoiceDictationMode = 'default' | 'story';

export interface VoiceInputStartOptions {
  dictationMode?: VoiceDictationMode;
}

export interface VoiceInputCallbacks {
  onTranscript: (fullText: string, meta: TranscriptMeta) => void;
  onStateChange?: (state: VoiceInputState) => void;
  onError?: (code: SpeechRecognitionErrorCode, message: string) => void;
}