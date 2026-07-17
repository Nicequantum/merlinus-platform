'use client';

import type { LucideIcon } from 'lucide-react';

interface BenzEmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  compact?: boolean;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function BenzEmptyState({
  icon: Icon,
  title,
  hint,
  compact = false,
  className = '',
  actionLabel,
  onAction,
}: BenzEmptyStateProps) {
  return (
    <div className={`benz-empty-state ${compact ? 'benz-empty-state-compact' : ''} ${className}`.trim()}>
      <div className="benz-empty-state-icon" aria-hidden="true">
        <Icon size={compact ? 26 : 32} strokeWidth={1.5} />
      </div>
      <p className="benz-empty-state-title">{title}</p>
      {hint && <p className="benz-empty-state-hint">{hint}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="primary-btn h-11 px-6 mt-4 text-sm touch-target">
          {actionLabel}
        </button>
      )}
    </div>
  );
}