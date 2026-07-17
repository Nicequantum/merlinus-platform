'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PHASE_THRESHOLDS_MS = [0, 2_000, 6_000] as const;
const PHASE_KEYS = ['phaseThinking', 'phaseWriting', 'phasePolishing'] as const;

/** English fallbacks for unit tests / non-i18n callers. */
export const STORY_GENERATION_PHASES = [
  'Thinking…',
  'Writing story…',
  'Polishing narrative…',
] as const;

export function useStoryGenerationPhase(active: boolean): { message: string; progress: number } {
  const { t } = useTranslation('line');
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

  let phaseIndex = 0;
  if (active) {
    for (let i = PHASE_THRESHOLDS_MS.length - 1; i >= 0; i--) {
      if (elapsedMs >= PHASE_THRESHOLDS_MS[i]) {
        phaseIndex = i;
        break;
      }
    }
  }

  // Ease toward 92% so the bar keeps moving without implying false completion.
  const progress = active ? Math.min(92, 6 + elapsedMs / 850) : 0;

  return { message: t(PHASE_KEYS[phaseIndex]), progress };
}
