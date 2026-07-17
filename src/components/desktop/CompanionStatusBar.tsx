'use client';

import { Loader2, Mic, Shield, Sparkles } from 'lucide-react';
import type { CompanionWorkflowStatus } from '@/lib/companionSyncTypes';

interface CompanionStatusBarProps {
  status: CompanionWorkflowStatus;
  message?: string | null;
  progress?: number | null;
}

const STATUS_COPY: Record<CompanionWorkflowStatus, { label: string; icon: 'mic' | 'sparkles' | 'shield' | 'loader' }> = {
  idle: { label: 'Ready — tablet actions sync here instantly', icon: 'loader' },
  listening: { label: 'Listening to voice…', icon: 'mic' },
  generating: { label: 'Generating story…', icon: 'sparkles' },
  scoring: { label: 'Running MI audit…', icon: 'shield' },
  reviewing: { label: 'AI review in progress…', icon: 'sparkles' },
  processing_xentry: { label: 'Processing Xentry photos…', icon: 'loader' },
  certifying: { label: 'Certifying story…', icon: 'shield' },
  scanning: { label: 'Scanning repair order…', icon: 'loader' },
};

function StatusIcon({ kind }: { kind: 'mic' | 'sparkles' | 'shield' | 'loader' }) {
  if (kind === 'mic') return <Mic size={16} className="text-benz-blue shrink-0" />;
  if (kind === 'sparkles') return <Sparkles size={16} className="text-benz-blue shrink-0" />;
  if (kind === 'shield') return <Shield size={16} className="text-benz-blue shrink-0" />;
  return <Loader2 size={16} className="text-benz-muted shrink-0" />;
}

export function CompanionStatusBar({ status, message, progress }: CompanionStatusBarProps) {
  const copy = STATUS_COPY[status];
  const active = status !== 'idle';
  const label = message?.trim() || copy.label;

  return (
    <div
      className={`benz-companion-status ${active ? 'benz-companion-status-active' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {active ? (
          <Loader2 size={16} className="animate-spin text-benz-blue shrink-0" />
        ) : (
          <StatusIcon kind={copy.icon} />
        )}
        <span className="text-sm text-benz-silver truncate">{label}</span>
      </div>
      {typeof progress === 'number' && progress > 0 && (
        <div className="benz-companion-status-progress" aria-hidden>
          <div className="benz-companion-status-progress-bar" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
    </div>
  );
}