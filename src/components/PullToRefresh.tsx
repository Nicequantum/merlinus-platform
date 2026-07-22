'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  /** Disable when searching or already loading */
  disabled?: boolean;
  className?: string;
}

const THRESHOLD_PX = 72;

/**
 * Tablet-friendly pull-to-refresh (touch). Keyboard users still get list refresh via Retry.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled,
  className = '',
}: PullToRefreshProps) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const runRefresh = useCallback(async () => {
    if (disabled || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [disabled, onRefresh, refreshing]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || refreshing) return;
    const el = scrollRef.current;
    if (el && el.scrollTop > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null || disabled || refreshing) return;
    const y = e.touches[0]?.clientY ?? startY.current;
    const delta = Math.max(0, y - startY.current);
    // Only engage when pulling down from top
    if (delta > 8) {
      setPull(Math.min(120, delta * 0.55));
    }
  };

  const onTouchEnd = () => {
    if (startY.current == null) return;
    const shouldRefresh = pull >= THRESHOLD_PX;
    startY.current = null;
    if (shouldRefresh) {
      void runRefresh();
    } else {
      setPull(0);
    }
  };

  const showHint = pull > 12 || refreshing;
  const ready = pull >= THRESHOLD_PX;

  return (
    <div
      ref={scrollRef}
      className={`relative ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        startY.current = null;
        if (!refreshing) setPull(0);
      }}
    >
      <div
        className="flex items-center justify-center gap-2 text-xs text-benz-secondary overflow-hidden transition-[height] duration-150"
        style={{ height: showHint ? Math.max(pull, refreshing ? 44 : 0) : 0 }}
        aria-live="polite"
        aria-busy={refreshing}
      >
        {refreshing ? (
          <>
            <Loader2 size={16} className="animate-spin text-benz-blue" aria-hidden />
            <span>Refreshing…</span>
          </>
        ) : (
          <>
            <ArrowDown
              size={16}
              className={`text-benz-blue transition-transform ${ready ? 'rotate-180' : ''}`}
              aria-hidden
            />
            <span>{ready ? 'Release to refresh' : 'Pull to refresh'}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
