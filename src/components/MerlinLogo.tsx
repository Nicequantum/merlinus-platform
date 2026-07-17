'use client';

import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

interface MerlinLogoProps {
  className?: string;
  title?: string;
  animated?: boolean;
}

/** Platform logo mark — Apex National Platform (Mercedes emblem removed). */
export function MerlinLogo({ className = 'w-full h-full', title, animated }: MerlinLogoProps) {
  return (
    <ApexLogoMark
      size="md"
      className={className}
      title={title}
      animated={animated}
    />
  );
}
