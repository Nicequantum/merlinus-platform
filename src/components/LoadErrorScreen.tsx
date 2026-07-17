'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

interface LoadErrorScreenProps {
  title: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Technician-friendly retry screen for failed initial data loads. */
export function LoadErrorScreen({ title, message, onRetry, retrying = false }: LoadErrorScreenProps) {
  const { t } = useTranslation('common');
  return (
    <div className="app-container flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <ApexLogoMark size="md" className="mb-4" title="Apex" />
      <div className="benz-empty-state-icon mb-3 text-benz-amber" aria-hidden>
        <AlertTriangle size={28} strokeWidth={1.5} />
      </div>
      <h1 className="text-lg font-semibold text-benz-primary mb-2">{title}</h1>
      <p className="text-sm text-benz-secondary max-w-sm leading-relaxed mb-6">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="primary-btn h-13 px-8 flex items-center justify-center gap-2.5 touch-target disabled:opacity-60"
      >
        <RefreshCw size={18} className={retrying ? 'animate-spin' : ''} />
        {retrying ? t('retrying') : t('retry')}
      </button>
      <p className="benz-hint mt-6 max-w-xs">{t('loadErrorHint')}</p>
    </div>
  );
}
