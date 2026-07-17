'use client';

import { CheckCircle2, Circle, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StoryComplianceState } from '@/lib/storyComplianceState';

interface StoryComplianceIndicatorProps {
  state: StoryComplianceState;
}

function stepIndex(state: StoryComplianceState): number {
  if (state === 'certified') return 2;
  if (state === 'audited' || state === 'audit-stale') return 1;
  return 0;
}

export function StoryComplianceIndicator({ state }: StoryComplianceIndicatorProps) {
  const { t } = useTranslation('story');
  const activeIndex = stepIndex(state);
  const isStale = state === 'audit-stale';

  const steps: { key: StoryComplianceState; label: string }[] = [
    { key: 'not-audited', label: t('stepNotAudited') },
    { key: 'audited', label: t('stepAudited') },
    { key: 'certified', label: t('stepCertified') },
  ];

  const statusLabel =
    state === 'certified'
      ? t('labelCertified')
      : isStale
        ? t('labelAuditStale')
        : state === 'audited'
          ? t('labelAudited')
          : t('labelNotAudited');

  return (
    <div className="benz-card p-3.5 mb-4 border border-benz-accent/20 bg-benz-accent/5">
      <div className="flex items-center gap-2 mb-2.5">
        <Shield size={14} className="text-benz-blue shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-benz-silver">
          {t('complianceTitle')}
        </span>
        <span
          className={`ml-auto text-xs font-semibold ${
            state === 'certified'
              ? 'text-benz-green'
              : isStale
                ? 'text-benz-amber'
                : state === 'audited'
                  ? 'text-benz-blue'
                  : 'text-benz-secondary'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {steps.map((step, index) => {
          const done = index < activeIndex || (index === activeIndex && state === 'certified');
          const current = index === activeIndex && state !== 'certified';

          return (
            <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
              <div
                className={`flex items-center gap-1.5 min-w-0 ${
                  current ? (isStale ? 'text-benz-amber' : 'text-benz-blue') : done ? 'text-benz-green' : 'text-benz-muted'
                }`}
              >
                {done ? (
                  <CheckCircle2 size={14} className="shrink-0" />
                ) : (
                  <Circle size={14} className="shrink-0" />
                )}
                <span className="text-[11px] font-medium truncate">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`h-px flex-1 mx-0.5 ${
                    index < activeIndex ? 'bg-benz-green/50' : 'bg-benz-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {state === 'not-audited' && (
        <p className="text-xs text-benz-secondary mt-2.5 leading-snug">{t('hintNotAudited')}</p>
      )}
      {state === 'audited' && (
        <p className="text-xs text-benz-secondary mt-2.5 leading-snug">{t('hintAudited')}</p>
      )}
      {isStale && <p className="text-xs text-benz-amber mt-2.5 leading-snug">{t('hintStale')}</p>}
      {state === 'certified' && (
        <p className="text-xs text-benz-green mt-2.5 leading-snug">{t('hintCertified')}</p>
      )}
    </div>
  );
}
