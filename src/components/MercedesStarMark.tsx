'use client';

import { useId } from 'react';
import { APEX_LOGO_VIEWBOX } from '@/lib/apexLogo/palette';
import { renderApexPremiumEmblemMarkup } from '@/lib/apexLogo/renderPremiumEmblem';

interface MercedesStarMarkProps {
  className?: string;
  title?: string;
  animated?: boolean;
}

/**
 * @deprecated Name kept for import stability — renders Apex National Platform emblem
 * (Mercedes star branding removed).
 */
export function MercedesStarMark({ className, title, animated = false }: MercedesStarMarkProps) {
  const uid = useId().replace(/:/g, '');
  const labelled = Boolean(title);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${APEX_LOGO_VIEWBOX} ${APEX_LOGO_VIEWBOX}`}
      className={[className, animated ? 'apex-logo-animated' : ''].filter(Boolean).join(' ') || undefined}
      role={labelled ? 'img' : 'presentation'}
      aria-hidden={labelled ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g dangerouslySetInnerHTML={{ __html: renderApexPremiumEmblemMarkup(`apex-${uid}`) }} />
    </svg>
  );
}
