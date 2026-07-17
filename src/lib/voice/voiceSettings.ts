/**
 * Dealership voice input configuration.
 * M18/M19: env overrides for timeout and confidence tuning on shop-floor tablets.
 */

export interface VoiceInputSettings {
  enabled: boolean;
  language: string;
  continuous: boolean;
  /** Inactivity timeout (ms). 0 = disabled — mic stays on until user taps stop. */
  listeningTimeoutMs: number;
  silenceRestartDelayMs: number;
  maxAutoRestarts: number;
  baseConfidenceThreshold: number;
  minConfidenceThreshold: number;
  noiseAdjustmentFactor: number;
  pushToTalkDefault: boolean;
  showNoiseMeter: boolean;
  showConfidence: boolean;
  autoGainControl: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  modeStorageKey: string;
}

export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  enabled: true,
  language: 'en-US',
  continuous: true,
  listeningTimeoutMs: 0,
  silenceRestartDelayMs: 400,
  maxAutoRestarts: 60,
  baseConfidenceThreshold: 0.55,
  minConfidenceThreshold: 0.22,
  noiseAdjustmentFactor: 0.38,
  pushToTalkDefault: false,
  showNoiseMeter: false,
  showConfidence: false,
  autoGainControl: true,
  noiseSuppression: true,
  echoCancellation: true,
  modeStorageKey: 'merlin-voice-input-mode',
};

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function envNumber(key: string, fallback: number, allowZero = false): number {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw)) return fallback;
  if (allowZero && raw === 0) return 0;
  return raw > 0 ? raw : fallback;
}

/** Resolve settings with optional deployment overrides (M18/M19). */
export function resolveVoiceInputSettings(): VoiceInputSettings {
  return {
    ...DEFAULT_VOICE_INPUT_SETTINGS,
    enabled: envBool('VOICE_INPUT_ENABLED', DEFAULT_VOICE_INPUT_SETTINGS.enabled),
    language: process.env.VOICE_INPUT_LANGUAGE?.trim() || DEFAULT_VOICE_INPUT_SETTINGS.language,
    listeningTimeoutMs: envNumber(
      'VOICE_LISTENING_TIMEOUT_MS',
      DEFAULT_VOICE_INPUT_SETTINGS.listeningTimeoutMs,
      true
    ),
    baseConfidenceThreshold: envNumber(
      'VOICE_BASE_CONFIDENCE',
      DEFAULT_VOICE_INPUT_SETTINGS.baseConfidenceThreshold
    ),
    minConfidenceThreshold: envNumber(
      'VOICE_MIN_CONFIDENCE',
      DEFAULT_VOICE_INPUT_SETTINGS.minConfidenceThreshold
    ),
  };
}