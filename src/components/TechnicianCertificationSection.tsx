'use client';

import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StableInput } from '@/components/StableInput';

interface TechnicianCertificationSectionProps {
  lineId: string;
  checked: boolean;
  certifiedName: string;
  onCheckedChange: (checked: boolean) => void;
  onNameChange: (name: string) => void;
  isComplete: boolean;
  isSaved: boolean;
  pendingReaudit?: boolean;
}

export function TechnicianCertificationSection({
  lineId,
  checked,
  certifiedName,
  onCheckedChange,
  onNameChange,
  isComplete,
  isSaved,
  pendingReaudit = false,
}: TechnicianCertificationSectionProps) {
  const { t } = useTranslation('story');

  return (
    <div className="benz-card p-4 mt-4 border border-benz-accent/25 bg-benz-accent/5">
      <div className="flex items-center gap-2 mb-3">
        <Shield size={16} className="text-benz-blue shrink-0" />
        <div className="benz-section-title">{t('certTitle')}</div>
      </div>

      <p className="text-sm text-benz-silver leading-relaxed mb-4">{t('certDisclaimer')}</p>

      {pendingReaudit && !isSaved && (
        <p className="text-xs text-benz-amber mb-4 leading-snug">{t('certPendingReaudit')}</p>
      )}

      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={isSaved || pendingReaudit}
          className="mt-1 h-4 w-4 shrink-0 accent-benz-blue"
        />
        <span className="text-sm text-benz-primary leading-snug">{t('certCheckbox')}</span>
      </label>

      <div>
        <label className="benz-label mb-2" htmlFor={`certify-name-${lineId}`}>
          {t('certNameLabel')}
        </label>
        <StableInput
          id={`certify-name-${lineId}`}
          fieldKey={`${lineId}-certify-name`}
          value={certifiedName}
          onChange={onNameChange}
          disabled={isSaved || pendingReaudit}
          placeholder={t('certNamePlaceholder')}
          className="benz-input w-full"
          autoComplete="name"
        />
      </div>

      {!isComplete && !isSaved && !pendingReaudit && (
        <p className="text-xs text-benz-amber mt-3 leading-snug">{t('certIncompleteHint')}</p>
      )}

      {isSaved && (
        <p className="text-xs text-benz-green mt-3 leading-snug flex items-center gap-1.5">
          <Shield size={12} /> {t('certSaved')}
        </p>
      )}
    </div>
  );
}
