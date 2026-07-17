'use client';

import { useTranslation } from 'react-i18next';
import type { ExtractedData } from '@/types';
import { normalizeExtractedData } from '@/utils/diagnosticParser';

interface ExtractedDataPreviewProps {
  data?: ExtractedData | null;
}

export function ExtractedDataPreview({ data }: ExtractedDataPreviewProps) {
  const { t } = useTranslation('line');
  const { t: tCommon } = useTranslation('common');
  const extracted = normalizeExtractedData(data);
  const hasContent =
    extracted.faultCodes.length > 0 ||
    extracted.guidedTests.length > 0 ||
    extracted.measurements.length > 0 ||
    extracted.components.length > 0;

  if (!hasContent) return null;

  return (
    <div className="benz-extracted-panel mt-3">
      <div className="benz-section-title mb-2">{t('extractedTitle')}</div>
      {extracted.faultCodes.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {extracted.faultCodes.slice(0, 4).map((fc) => (
            <div key={fc.code} className="leading-relaxed">
              <span className="text-benz-blue font-mono font-semibold">{fc.code}</span>
              {fc.description ? <span className="text-benz-secondary"> — {fc.description}</span> : ''}
              {fc.status ? <span className="text-benz-muted"> ({fc.status})</span> : null}
            </div>
          ))}
          {extracted.faultCodes.length > 4 && (
            <div className="text-benz-muted">
              {tCommon('moreCodes', { count: extracted.faultCodes.length - 4 })}
            </div>
          )}
        </div>
      )}
      {extracted.guidedTests.length > 0 && (
        <div className="text-benz-secondary">
          {tCommon('guided')}: {extracted.guidedTests.slice(0, 2).join(' | ')}
        </div>
      )}
      {extracted.measurements.length > 0 && (
        <div className="text-benz-secondary mt-1">
          {tCommon('meas')}: {extracted.measurements[0].label}={extracted.measurements[0].value}
        </div>
      )}
    </div>
  );
}
