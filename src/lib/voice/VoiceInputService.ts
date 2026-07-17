import { computeAdaptiveConfidenceThreshold, passesConfidenceGate } from './confidence';
import { applySpokenPunctuation, normalizeDictationSpacing } from './dictationPunctuation';
import { processDictationChunk } from './dictationText';
import { resolveVoiceErrorMessage, shouldAutoRestartAfterError } from './errors';
import { getSpeechRecognitionCtor } from './speechRecognition';
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
  TranscriptMeta,
  VoiceDictationMode,
  VoiceInputCallbacks,
  VoiceInputMode,
  VoiceInputStartOptions,
  VoiceInputState,
  VoiceInputTargetContext,
  VoicePermissionState,
} from './types';
import type { VoiceInputSettings } from './voiceSettings';
import { claimVoiceSession, releaseVoiceSession, type VoiceSessionHandle } from './voiceSessionCoordinator';

const INITIAL_STATE: VoiceInputState = {
  listeningState: 'idle',
  isListening: false,
  isSupported: false,
  permission: 'unknown',
  mode: 'toggle',
  noiseLevel: 0,
  confidence: null,
  confidenceThreshold: 0.55,
  interimText: '',
  committedText: '',
  restartCount: 0,
  errorMessage: null,
  errorCode: null,
};

/**
 * Encapsulates Web Speech API recognition, adaptive confidence,
 * auto-restart, and cleanup for Merlin repair-line voice entry.
 */
export class VoiceInputService {
  private recognition: SpeechRecognitionInstance | null = null;
  private state: VoiceInputState = { ...INITIAL_STATE };
  private callbacks: VoiceInputCallbacks | null = null;
  private target: VoiceInputTargetContext | null = null;
  private targetElement: HTMLTextAreaElement | HTMLInputElement | null = null;
  /** M15: detach when target is removed; resync prefix/suffix on manual edits during dictation. */
  private manualEditListener: ((event: Event) => void) | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private userStopped = false;
  private destroyed = false;
  /** C7: true while intentionally replacing a recognizer — ignore its aborted/error callbacks. */
  private supersedingRecognition = false;
  private readonly sessionHandle: VoiceSessionHandle = {
    stop: () => this.stop(),
  };
  private dictationMode: VoiceDictationMode = 'default';
  /** Mutable per-instance settings (never mutate shared module defaults). */
  private readonly settings: VoiceInputSettings;

  constructor(settings: VoiceInputSettings) {
    // Clone so setLanguage / mode never mutates VOICE_INPUT_SETTINGS singleton.
    this.settings = { ...settings };
    this.state.isSupported = getSpeechRecognitionCtor() != null;
    this.state.mode = this.settings.pushToTalkDefault ? 'push-to-talk' : 'toggle';
    this.state.confidenceThreshold = this.settings.baseConfidenceThreshold;
  }

  getState(): VoiceInputState {
    return { ...this.state };
  }

  setMode(mode: VoiceInputMode): void {
    this.patchState({ mode });
  }

  /** Runtime STT language (BCP-47). Preference overrides deploy default. */
  setLanguage(language: string): void {
    const next = language.trim() || this.settings.language;
    if (next === this.settings.language) return;
    this.settings.language = next;
    // Active recognition picks up language on next startRecognition.
  }

  getLanguage(): string {
    return this.settings.language;
  }

  async refreshPermission(): Promise<VoicePermissionState> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patchState({ permission: 'denied' });
      return 'denied';
    }
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const permission = status.state as VoicePermissionState;
      this.patchState({ permission });
      status.onchange = () => {
        this.patchState({ permission: status.state as VoicePermissionState });
      };
      return permission;
    } catch {
      this.patchState({ permission: 'unknown' });
      return 'unknown';
    }
  }

  /**
   * Begin listening at the caret position in the target field.
   * Returns false when SpeechRecognition is unavailable.
   */
  async start(
    element: HTMLTextAreaElement | HTMLInputElement,
    callbacks: VoiceInputCallbacks,
    options?: VoiceInputStartOptions
  ): Promise<boolean> {
    this.dictationMode = options?.dictationMode ?? 'default';
    if (this.destroyed) return false;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.patchState({ listeningState: 'unsupported', isListening: false });
      return false;
    }

    this.clearTimers();
    this.userStopped = false;
    // C6: stop any other field's voice session before claiming the mic.
    claimVoiceSession(this.sessionHandle);
    this.callbacks = callbacks;
    this.targetElement = element;

    const selectionStart = element.selectionStart ?? element.value.length;
    const selectionEnd = element.selectionEnd ?? element.value.length;
    this.target = {
      prefix: element.value.slice(0, selectionStart),
      suffix: element.value.slice(selectionEnd),
      committed: '',
      selectionStart,
      selectionEnd,
    };

    this.patchState({
      listeningState: 'requesting-permission',
      errorMessage: null,
      errorCode: null,
      interimText: '',
      committedText: '',
      restartCount: 0,
    });

    await this.refreshPermission();
    // Do not call getUserMedia before SpeechRecognition — releasing the probe stream
    // can leave the mic unavailable for transcription on Windows shop-floor tablets.

    this.attachManualEditGuard(element);

    const started = this.startRecognition(Ctor);
    if (!started) {
      this.detachManualEditGuard();
    }
    return started;
  }

  /** Stop recognition gracefully (final results may still flush). */
  stop(): void {
    this.userStopped = true;
    this.clearTimers();
    this.flushTranscriptToTarget(true);
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        this.disposeRecognition();
      }
    }
    releaseVoiceSession(this.sessionHandle);
    this.detachManualEditGuard();
    this.patchState({
      isListening: false,
      listeningState: 'idle',
      interimText: '',
    });
  }

  /** Immediate teardown — used on unmount/navigation. */
  destroy(): void {
    this.destroyed = true;
    this.userStopped = true;
    this.clearTimers();
    this.disposeRecognition();
    releaseVoiceSession(this.sessionHandle);
    this.detachManualEditGuard();
    this.callbacks = null;
    this.target = null;
    this.targetElement = null;
    this.state = { ...INITIAL_STATE, isSupported: getSpeechRecognitionCtor() != null };
  }

  /** Retry after listening timeout or error UX. */
  async retry(options?: VoiceInputStartOptions): Promise<boolean> {
    if (!this.targetElement || !this.callbacks) return false;
    this.userStopped = false;
    this.patchState({ restartCount: 0, errorMessage: null, errorCode: null });
    return this.start(this.targetElement, this.callbacks, options);
  }

  private startRecognition(Ctor: NonNullable<ReturnType<typeof getSpeechRecognitionCtor>>): boolean {
    // C7: detach handlers before abort so superseded instances cannot schedule restarts.
    this.disposeRecognition();

    const recognition = new Ctor();
    recognition.continuous = this.settings.continuous;
    recognition.interimResults = true;
    recognition.lang = this.settings.language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.patchState({ listeningState: 'listening', isListening: true });
      this.resetListeningTimeout();
    };

    recognition.onresult = (event) => this.handleResult(event);

    recognition.onerror = (event) => {
      const code = event.error;
      if (code === 'aborted' && (this.userStopped || this.supersedingRecognition)) return;

      const message = resolveVoiceErrorMessage(code);
      this.patchState({
        errorCode: code,
        errorMessage: message,
      });
      this.callbacks?.onError?.(code, message);

      const canRestart =
        this.state.mode === 'toggle' &&
        this.settings.continuous &&
        !this.userStopped &&
        shouldAutoRestartAfterError(code, this.state.restartCount, this.settings.maxAutoRestarts);

      if (canRestart) {
        this.scheduleRestart();
      } else if (code !== 'aborted') {
        this.patchState({ listeningState: 'error', isListening: false });
      }
    };

    recognition.onend = () => {
      if (this.userStopped || this.destroyed || this.supersedingRecognition) {
        this.patchState({ isListening: false, listeningState: 'idle', interimText: '' });
        return;
      }

      const shouldRestart =
        this.state.mode === 'toggle' &&
        this.settings.continuous &&
        this.state.restartCount < this.settings.maxAutoRestarts;

      if (shouldRestart) {
        this.scheduleRestart();
      } else {
        this.patchState({ isListening: false, listeningState: 'idle', interimText: '' });
      }
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.patchState({ isListening: true, listeningState: 'listening' });
      this.resetListeningTimeout();
      return true;
    } catch {
      this.patchState({ listeningState: 'error', isListening: false });
      return false;
    }
  }

  private handleResult(event: SpeechRecognitionEventLike): void {
    if (!this.target || !this.callbacks) return;

    this.resetListeningTimeout();

    let interim = '';
    let batchConfidence: number | null = null;
    let hasFinal = false;
    const threshold = computeAdaptiveConfidenceThreshold(this.state.noiseLevel, this.settings);

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative) continue;

      const confidence = alternative.confidence;
      if (confidence != null && !Number.isNaN(confidence)) {
        batchConfidence = batchConfidence == null ? confidence : Math.max(batchConfidence, confidence);
      }

      if (!passesConfidenceGate(confidence, threshold, this.state.noiseLevel)) continue;

      const rawText = alternative.transcript ?? '';
      const text =
        this.dictationMode === 'story' ? applySpokenPunctuation(rawText, 'story') : rawText;
      if (result.isFinal) {
        this.target.committed = processDictationChunk(
          this.target.committed,
          text,
          this.dictationMode,
          this.settings.language
        );
        hasFinal = true;
      } else {
        interim += text;
      }
    }

    const committed = this.target.committed;
    const interimText =
      this.dictationMode === 'story' ? normalizeDictationSpacing(interim) : interim;
    const full = this.target.prefix + committed + interimText + this.target.suffix;
    const meta: TranscriptMeta = {
      committed,
      interim: interimText,
      full,
      hasFinal,
      confidence: batchConfidence,
    };

    this.patchState({
      interimText,
      committedText: committed,
      confidence: batchConfidence,
      confidenceThreshold: threshold,
      listeningState: 'listening',
    });

    this.writeTargetValue(full);
    this.callbacks.onTranscript(full, meta);

    if (this.targetElement) {
      const cursor = this.target.prefix.length + committed.length + interimText.length;
      requestAnimationFrame(() => {
        try {
          this.targetElement?.setSelectionRange(cursor, cursor);
        } catch {
          // ignore selection errors on disabled/readOnly fields
        }
      });
    }
  }

  private writeTargetValue(full: string): void {
    if (!this.targetElement) return;
    this.applyingTranscript = true;
    this.targetElement.value = full;
    this.applyingTranscript = false;
  }

  /** Flush the current dictation buffer to the field and optional parent callback. */
  private flushTranscriptToTarget(markFinal: boolean): void {
    if (!this.target || !this.callbacks) return;
    const full = this.target.prefix + this.target.committed + this.target.suffix;
    this.writeTargetValue(full);
    this.callbacks.onTranscript(full, {
      committed: this.target.committed,
      interim: '',
      full,
      hasFinal: markFinal,
      confidence: this.state.confidence,
    });
  }

  private applyingTranscript = false;

  /** M15: manual keyboard edits during dictation become the new committed baseline. */
  private attachManualEditGuard(element: HTMLTextAreaElement | HTMLInputElement): void {
    this.detachManualEditGuard();
    this.manualEditListener = () => {
      if (!this.target || !this.targetElement || this.applyingTranscript) return;
      // While the mic is active, voice drives the field — ignore synthetic input churn.
      if (this.state.isListening) return;
      const value = this.targetElement.value;
      const cursor = this.targetElement.selectionStart ?? value.length;
      this.target.prefix = value.slice(0, cursor);
      this.target.suffix = value.slice(cursor);
      this.target.committed = '';
      this.patchState({ committedText: '', interimText: '' });
    };
    element.addEventListener('input', this.manualEditListener);
  }

  private detachManualEditGuard(): void {
    if (this.targetElement && this.manualEditListener) {
      this.targetElement.removeEventListener('input', this.manualEditListener);
    }
    this.manualEditListener = null;
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();
    const nextCount = this.state.restartCount + 1;
    this.patchState({ listeningState: 'restarting', restartCount: nextCount });

    this.restartTimer = setTimeout(() => {
      if (this.userStopped || this.destroyed) return;
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      this.startRecognition(Ctor);
    }, this.settings.silenceRestartDelayMs);
  }

  private resetListeningTimeout(): void {
    this.clearTimeoutTimer();
    if (this.settings.listeningTimeoutMs <= 0) return;

    this.timeoutTimer = setTimeout(() => {
      if (this.userStopped || !this.state.isListening) return;

      const canRestart =
        this.state.mode === 'toggle' &&
        this.settings.continuous &&
        this.state.restartCount < this.settings.maxAutoRestarts;

      if (canRestart) {
        this.scheduleRestart();
      } else {
        this.userStopped = true;
        this.recognition?.stop();
        this.patchState({
          isListening: false,
          listeningState: 'timeout',
          errorMessage: 'Listening timed out. Tap the mic or use the keyboard.',
          errorCode: 'no-speech',
        });
      }
    }, this.settings.listeningTimeoutMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearRestartTimer();
    this.clearTimeoutTimer();
  }

  /** C7: detach event handlers then abort — prevents ghost onend/onerror restart loops. */
  private disposeRecognition(): void {
    const recognition = this.recognition;
    if (!recognition) return;

    this.supersedingRecognition = true;
    this.recognition = null;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;

    try {
      recognition.abort();
    } catch {
      // ignore — browser may already be tearing down
    }

    this.supersedingRecognition = false;
  }

  private patchState(patch: Partial<VoiceInputState>): void {
    this.state = { ...this.state, ...patch };
    this.callbacks?.onStateChange?.(this.getState());
  }
}