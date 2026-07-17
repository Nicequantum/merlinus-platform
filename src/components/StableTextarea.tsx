'use client';

import { useCallback, useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import type { TranscriptMeta, VoiceDictationMode } from '@/lib/voice';
import { VoiceInputButton } from './VoiceInputButton';

interface StableTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  fieldKey: string;
  showVoice?: boolean;
  /** Use `story` for warranty/notes fields — enables spoken punctuation commands. */
  voiceDictationMode?: VoiceDictationMode;
}

function useStableDraft(value: string, fieldKey: string, suppressExternalSync: boolean) {
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const lastEmittedRef = useRef(value);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  // Reset draft only when the field identity changes — value sync is handled below.
  useEffect(() => {
    lastEmittedRef.current = value;
    setDraft(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fieldKey-only reset
  }, [fieldKey]);

  // Accept external updates (regenerate, Apply Tech Details, templates) even while focused.
  // Typing is safe: onChange already sets lastEmittedRef, so value === lastEmittedRef and we skip.
  useEffect(() => {
    if (suppressExternalSync) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDraft(value);
  }, [value, suppressExternalSync, lastEmittedRef]);

  const commit = useCallback((next: string, el?: HTMLTextAreaElement) => {
    if (el && isFocusedRef.current) {
      selectionRef.current = { start: el.selectionStart ?? next.length, end: el.selectionEnd ?? next.length };
    }
    setDraft(next);
    lastEmittedRef.current = next;
  }, []);

  const restoreSelection = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || !selectionRef.current) return;
    const { start, end } = selectionRef.current;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(start, end);
      } catch {
        // ignore unsupported selection states
      }
    });
  }, []);

  return { draft, isFocusedRef, lastEmittedRef, commit, restoreSelection };
}

export function StableTextarea({
  value,
  onChange,
  fieldKey,
  showVoice = true,
  voiceDictationMode = 'default',
  className = '',
  ...props
}: StableTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const wasVoiceListeningRef = useRef(false);
  const { draft, isFocusedRef, lastEmittedRef, commit, restoreSelection } = useStableDraft(
    value,
    fieldKey,
    voiceListening
  );

  const handleChange = (next: string) => {
    commit(next, textareaRef.current ?? undefined);
    onChange(next);
    restoreSelection(textareaRef.current);
  };

  const handleVoiceTranscript = useCallback(
    (next: string, meta?: TranscriptMeta) => {
      commit(next, textareaRef.current ?? undefined);
      restoreSelection(textareaRef.current);
      // Interim results stay local — parent persistence waits for finalized speech.
      if (meta?.hasFinal) {
        onChange(next);
      }
    },
    [commit, onChange, restoreSelection]
  );

  useEffect(() => {
    if (wasVoiceListeningRef.current && !voiceListening && draft !== lastEmittedRef.current) {
      lastEmittedRef.current = draft;
      onChange(draft);
    }
    wasVoiceListeningRef.current = voiceListening;
  }, [voiceListening, draft, onChange, lastEmittedRef]);

  return (
    <div className="relative w-full min-w-0">
      <textarea
        ref={textareaRef}
        {...props}
        value={draft}
        autoComplete="off"
        spellCheck
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
        onChange={(e) => handleChange(e.target.value)}
        className={`w-full min-w-0 touch-manipulation ${showVoice ? 'pr-10 pb-9 ' : ''}${className}`}
      />
      {showVoice && (
        <VoiceInputButton
          targetRef={textareaRef}
          onTranscript={handleVoiceTranscript}
          onListeningChange={setVoiceListening}
          dictationMode={voiceDictationMode}
          className="bottom-2 right-2"
        />
      )}
    </div>
  );
}