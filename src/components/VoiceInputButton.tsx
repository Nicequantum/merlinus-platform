'use client';

// Voice dictation uses the browser Web Speech API; audio is sent to Google's speech service.
import { Mic, MicOff } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSharedVoiceInput } from '@/components/VoiceInputProvider';
import { setCompanionVoiceListening } from '@/lib/companionVoiceBridge';
import type { TranscriptMeta, VoiceDictationMode } from '@/lib/voice';

interface VoiceInputButtonProps {
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  onTranscript: (value: string, meta?: TranscriptMeta) => void;
  onListeningChange?: (listening: boolean) => void;
  /** Story fields enable spoken punctuation commands (period, comma, new paragraph, etc.). */
  dictationMode?: VoiceDictationMode;
  className?: string;
}

function voiceErrorKey(code: string | null | undefined): string {
  switch (code) {
    case 'no-speech':
      return 'noSpeech';
    case 'aborted':
      return 'aborted';
    case 'audio-capture':
      return 'audioCapture';
    case 'network':
      return 'network';
    case 'not-allowed':
      return 'notAllowed';
    case 'service-not-allowed':
      return 'serviceNotAllowed';
    case 'language-not-supported':
      return 'languageNotSupported';
    default:
      return 'genericError';
  }
}

export function VoiceInputButton({
  targetRef,
  onTranscript,
  onListeningChange,
  dictationMode = 'default',
  className = '',
}: VoiceInputButtonProps) {
  const { t } = useTranslation('voice');
  const lastErrorRef = useRef<string | null>(null);
  const {
    isListening,
    activeTarget,
    isSupported,
    isEnabled,
    permission,
    listeningState,
    errorMessage,
    errorCode,
    toggleListening,
    refreshPermission,
  } = useSharedVoiceInput();

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  const isActiveField =
    (isListening || listeningState === 'restarting') && activeTarget === targetRef.current;

  useEffect(() => {
    onListeningChange?.(isActiveField);
    setCompanionVoiceListening(isActiveField);
  }, [isActiveField, onListeningChange]);

  useEffect(() => {
    if (listeningState !== 'error') return;
    const key = voiceErrorKey(errorCode);
    const msg = t(key);
    if (lastErrorRef.current === msg) return;
    lastErrorRef.current = msg;
    toast.error(msg || errorMessage || t('genericError'));
  }, [listeningState, errorCode, errorMessage, t]);

  const handleTranscript = useCallback(
    (value: string, meta?: TranscriptMeta) => {
      onTranscript(value, meta);
    },
    [onTranscript]
  );

  const handleClick = () => {
    const el = targetRef.current;
    if (!el) return;

    if (!isEnabled) {
      toast.message(t('disabled'));
      return;
    }
    if (!isSupported) {
      toast.error(t('notSupported'));
      return;
    }
    if (permission === 'denied') {
      toast.error(t('permissionDenied'));
      return;
    }

    lastErrorRef.current = null;
    toggleListening(el, handleTranscript, { dictationMode });
  };

  if (!isEnabled) return null;

  const micTitle = isActiveField ? t('stopMic') : t('startMic');
  const isActive = isActiveField;

  return (
    <button
      type="button"
      title={micTitle}
      aria-label={micTitle}
      aria-pressed={isActiveField}
      onClick={handleClick}
      className={`benz-voice-inline-btn touch-target ${isActive ? 'benz-voice-inline-btn-active' : ''} ${listeningState === 'restarting' ? 'benz-voice-inline-btn-restarting' : ''} ${className}`}
    >
      <span className="benz-voice-inline-btn-inner">
        {isActive && <span className="benz-voice-inline-pulse" aria-hidden />}
        {isActive ? <MicOff size={16} /> : <Mic size={16} />}
      </span>
    </button>
  );
}