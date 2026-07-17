'use client';

import { useEffect, useState } from 'react';

/** Rotating status copy while Grok generates a warranty story (scoring runs separately). */
export const STORY_GENERATION_PHASES = [
  'Thinking…',
  'Writing story…',
  'Polishing narrative…',
] as const;

const PHASE_THRESHOLDS_MS = [0, 2_000, 6_000] as const;

export function useStoryGenerationPhase(active: boolean): { message: string; progress: number } {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 350);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) {
    return { message: STORY_GENERATION_PHASES[0], progress: 0 };
  }

  let phaseIndex = 0;
  for (let i = PHASE_THRESHOLDS_MS.length - 1; i >= 0; i--) {
    if (elapsedMs >= PHASE_THRESHOLDS_MS[i]) {
      phaseIndex = i;
      break;
    }
  }

  // Ease toward 92% so the bar keeps moving without implying false completion.
  const progress = Math.min(92, 6 + elapsedMs / 850);

  return { message: STORY_GENERATION_PHASES[phaseIndex], progress };
}