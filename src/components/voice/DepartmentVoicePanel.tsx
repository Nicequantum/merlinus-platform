'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send, Sparkles, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/csrf';
import type { VoiceDepartmentId } from '@/lib/modules/catalog';

export type DepartmentVoicePhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'tool'
  | 'responding'
  | 'error';

interface DepartmentVoicePanelProps {
  department: VoiceDepartmentId;
  /** Short label e.g. "Service" */
  title?: string;
  /** Optional handoff from another department conversation */
  handoffBrief?: string | null;
  className?: string;
  /** Compact strip for tablet headers */
  compact?: boolean;
}

const DEPT_LABEL: Record<VoiceDepartmentId, string> = {
  service: 'Service',
  parts: 'Parts',
  sales: 'Sales',
  loaner: 'Loaner',
};

/**
 * Contextual Sophia panel for department screens — hands-free friendly.
 */
export function DepartmentVoicePanel({
  department,
  title,
  handoffBrief,
  className = '',
  compact = false,
}: DepartmentVoicePanelProps) {
  const [open, setOpen] = useState(!compact);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [phase, setPhase] = useState<DepartmentVoicePhase>('idle');
  const [statusLine, setStatusLine] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  const runQuery = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase('thinking');
      setStatusLine('Sophia is thinking…');
      setReply('');

      const csrf = readCsrfTokenFromDocument();
      try {
        const res = await fetch(`/api/voice/${department}/query`, {
          method: 'POST',
          credentials: 'include',
          signal: ac.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
          },
          body: JSON.stringify({
            message: trimmed,
            conversationId,
            handoffBrief: handoffBrief || undefined,
            stream: true,
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `Request failed (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) {
          // Fallback non-stream
          const data = (await res.json()) as { speech?: string; conversationId?: string };
          setReply(data.speech || '');
          if (data.conversationId) setConversationId(data.conversationId);
          setPhase('idle');
          setStatusLine('');
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(6)) as {
                type?: string;
                phase?: string;
                message?: string;
                text?: string;
                speech?: string;
                conversationId?: string;
                name?: string;
                ok?: boolean;
                summary?: string;
              };
              if (event.type === 'status') {
                if (event.phase === 'thinking') setPhase('thinking');
                if (event.phase === 'tool') setPhase('tool');
                if (event.phase === 'responding') setPhase('responding');
                if (event.phase === 'error') {
                  setPhase('error');
                  setStatusLine(event.message || 'Something went wrong');
                }
                if (event.message) setStatusLine(event.message);
                if (event.phase === 'done') {
                  setPhase('idle');
                  setStatusLine('');
                }
              }
              if (event.type === 'delta' && event.text) {
                assembled += event.text;
                setReply(assembled);
                setPhase('responding');
              }
              if (event.type === 'tool') {
                setPhase('tool');
                setStatusLine(
                  event.ok
                    ? `Checked ${event.name?.replace(/_/g, ' ')}…`
                    : `Note: ${event.summary || 'tool issue'}`
                );
              }
              if (event.type === 'result') {
                if (event.speech) {
                  assembled = event.speech;
                  setReply(event.speech);
                }
                if (event.conversationId) setConversationId(event.conversationId);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        setPhase('idle');
        setStatusLine('');
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        setPhase('error');
        const msg = error instanceof Error ? error.message : 'Sophia unavailable';
        setStatusLine(msg);
        toast.error(msg);
      }
    },
    [conversationId, department, handoffBrief]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = message;
    setMessage('');
    void runQuery(text);
  };

  const toggleListen = () => {
    const SR =
      typeof window !== 'undefined'
        ? window.SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
            .webkitSpeechRecognition
        : undefined;
    if (!SR) {
      toast.message('Voice dictation needs Chrome or Edge on this tablet');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onstart = () => {
      setListening(true);
      setPhase('listening');
      setStatusLine('Listening…');
    };
    rec.onerror = () => {
      setListening(false);
      setPhase('idle');
      setStatusLine('');
      toast.message('Mic stopped — try again or type your question');
    };
    rec.onend = () => {
      setListening(false);
      if (phase === 'listening') {
        setPhase('idle');
        setStatusLine('');
      }
    };
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r?.isFinal) finalText += r[0]?.transcript || '';
      }
      if (finalText.trim()) {
        setMessage(finalText.trim());
        void runQuery(finalText.trim());
      }
    };
    recognitionRef.current = rec;
    rec.start();
  };

  const label = title || DEPT_LABEL[department];

  if (compact && !open) {
    return (
      <button
        type="button"
        className={`secondary-btn h-11 px-3 text-xs font-semibold flex items-center gap-2 touch-target-bay ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`Open Sophia ${label} assistant`}
      >
        <Sparkles size={16} className="text-benz-blue" />
        Ask Sophia
      </button>
    );
  }

  const phaseClass =
    phase === 'listening'
      ? 'border-emerald-500/50 bg-emerald-500/10'
      : phase === 'thinking' || phase === 'tool'
        ? 'border-benz-blue/40 bg-benz-blue/5'
        : phase === 'error'
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-benz-border/60';

  return (
    <div
      className={`rounded-xl border ${phaseClass} p-3 sm:p-4 space-y-3 ${className}`}
      role="region"
      aria-label={`Sophia ${label} assistant`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={18} className="text-benz-blue shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">
              Sophia · {label}
            </div>
            <div className="text-[11px] text-benz-secondary" aria-live="polite">
              {statusLine ||
                (phase === 'idle'
                  ? 'Ask about appointments, loaners, or follow-ups'
                  : phase)}
            </div>
          </div>
        </div>
        {compact ? (
          <button
            type="button"
            className="text-xs text-benz-secondary underline touch-target"
            onClick={() => setOpen(false)}
          >
            Hide
          </button>
        ) : null}
      </div>

      {reply ? (
        <div className="rounded-lg bg-black/5 dark:bg-white/5 px-3 py-2.5 text-sm leading-relaxed">
          <div className="flex items-start gap-2">
            <Volume2 size={14} className="mt-0.5 text-benz-blue shrink-0" aria-hidden />
            <p>{reply}</p>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
        <label className="sr-only" htmlFor={`sophia-${department}-input`}>
          Message for Sophia {label}
        </label>
        <input
          id={`sophia-${department}-input`}
          className="benz-input flex-1 touch-target-bay"
          placeholder={
            department === 'loaner'
              ? 'e.g. Any loaners available for a C-Class service customer?'
              : department === 'service'
                ? 'e.g. Customer needs oil service next Tuesday…'
                : 'Ask Sophia…'
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={phase === 'thinking' || phase === 'tool'}
          autoComplete="off"
        />
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            className={`secondary-btn h-11 px-3 touch-target-bay ${
              listening ? 'ring-2 ring-emerald-500' : ''
            }`}
            onClick={toggleListen}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Start voice input'}
          >
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            type="submit"
            className="primary-btn h-11 px-4 touch-target-bay font-semibold flex items-center gap-1.5"
            disabled={!message.trim() || phase === 'thinking' || phase === 'tool'}
          >
            {phase === 'thinking' || phase === 'tool' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

// DOM lib types for SpeechRecognition (Chrome)
interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognition };
    webkitSpeechRecognition?: { new (): SpeechRecognition };
  }
}
