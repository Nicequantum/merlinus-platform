'use client';

import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

type MerlinLogoMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface MerlinLogoMarkProps {
  size?: MerlinLogoMarkSize;
  className?: string;
  title?: string;
  animated?: boolean;
}

/** @deprecated Prefer ApexLogoMark — maps to Apex National Platform logo. */
export function MerlinLogoMark({ size = 'md', className, title, animated }: MerlinLogoMarkProps) {
  const apexSize = size === 'xs' ? 'sm' : size;
  return (
    <ApexLogoMark size={apexSize} className={className} title={title ?? 'Apex'} animated={animated} />
  );
}
