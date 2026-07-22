'use client';

/**
 * Luxury bay progress for async AI jobs — feels instant on slow Wi‑Fi.
 * Phases: Queued → Processing → AI Thinking → Complete
 */

export type AiJobProgressPhase =
  | 'queued'
  | 'processing'
  | 'ai_thinking'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | string;

const PHASE_ORDER: AiJobProgressPhase[] = [
  'queued',
  'processing',
  'ai_thinking',
  'complete',
];

const PHASE_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ai_thinking: 'AI Thinking',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface AiJobProgressBannerProps {
  phase: AiJobProgressPhase;
  progress: number;
  /** Optional second line (technician-friendly) */
  description?: string;
  className?: string;
}

export function AiJobProgressBanner({
  phase,
  progress,
  description,
  className = '',
}: AiJobProgressBannerProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const activeIdx = Math.max(
    0,
    PHASE_ORDER.indexOf(phase === 'running' ? 'processing' : phase)
  );

  return (
    <div
      className={`rounded-xl border border-benz-border/60 bg-benz-card/80 px-3 py-3 shadow-sm ${className}`}
      role="status"
      aria-live="polite"
      aria-label={`${PHASE_LABELS[phase] || phase}, ${pct} percent`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold tracking-tight">
          {PHASE_LABELS[phase] || phase}
        </div>
        <div className="text-xs font-mono text-benz-secondary tabular-nums">{pct}%</div>
      </div>
      <div className="h-2 rounded-full bg-benz-border/40 overflow-hidden mb-2.5">
        <div
          className="h-full rounded-full bg-benz-blue transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <ol className="flex items-center justify-between gap-1" aria-hidden>
        {PHASE_ORDER.map((p, i) => {
          const done = i < activeIdx || phase === 'complete';
          const current = i === activeIdx && phase !== 'complete' && phase !== 'failed';
          return (
            <li
              key={p}
              className={`flex-1 text-center text-[10px] font-semibold uppercase tracking-wide ${
                done
                  ? 'text-benz-green'
                  : current
                    ? 'text-benz-blue'
                    : 'text-benz-muted'
              }`}
            >
              {PHASE_LABELS[p]}
            </li>
          );
        })}
      </ol>
      {description ? (
        <p className="text-[11px] text-benz-secondary mt-2 leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
