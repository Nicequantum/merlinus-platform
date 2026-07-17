'use client';

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import type { TranscriptMeta } from '@/lib/voice';
import { VoiceInputButton } from './VoiceInputButton';

interface StableInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  fieldKey: string;
  showVoice?: boolean;
}

export function StableInput({
  value,
  onChange,
  fieldKey,
  showVoice = false,
  className = '',
  ...props
}: StableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const wasVoiceListeningRef = useRef(false);
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const lastEmittedRef = useRef(value);

  // Reset draft only when the field identity changes — value sync is handled below.
  useEffect(() => {
    lastEmittedRef.current = value;
    setDraft(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fieldKey-only reset
  }, [fieldKey]);

  useEffect(() => {
    if (voiceListening) return;
    if (isFocusedRef.current) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDraft(value);
  }, [value, voiceListening]);

  const commit = useCallback(
    (next: string) => {
      setDraft(next);
      lastEmittedRef.current = next;
      onChange(next);
    },
    [onChange]
  );

  const handleVoiceTranscript = useCallback(
    (next: string, meta?: TranscriptMeta) => {
      setDraft(next);
      lastEmittedRef.current = next;
      if (meta?.hasFinal) {
        onChange(next);
      }
    },
    [onChange]
  );

  useEffect(() => {
    if (wasVoiceListeningRef.current && !voiceListening && draft !== lastEmittedRef.current) {
      lastEmittedRef.current = draft;
      onChange(draft);
    }
    wasVoiceListeningRef.current = voiceListening;
  }, [voiceListening, draft, onChange]);

  return (
    <div className="relative w-full min-w-0">
      <input
        ref={inputRef}
        {...props}
        value={draft}
        autoComplete="off"
        onFocus={(e) => {
          isFocusedRef.current = true;
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          isFocusedRef.current = false;
          if (draft !== lastEmittedRef.current) {
            lastEmittedRef.current = draft;
            onChange(draft);
          }
          props.onBlur?.(e);
        }}
        onChange={(e) => commit(e.target.value)}
        className={`w-full min-w-0 touch-manipulation ${showVoice ? 'pr-10 ' : ''}${className}`}
      />
      {showVoice && (
        <VoiceInputButton
          targetRef={inputRef}
          onTranscript={handleVoiceTranscript}
          onListeningChange={setVoiceListening}
          className="right-2 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  );
}