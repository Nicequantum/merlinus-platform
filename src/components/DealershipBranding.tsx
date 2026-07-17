'use client';

import { DEALERSHIP_CODE, DEALERSHIP_DISPLAY_NAME } from '@/lib/constants';
import { isApexPlatformMode } from '@/lib/platformMode';

interface DealershipBrandingProps {
  size?: 'lg' | 'md' | 'sm';
  className?: string;
  /**
   * Rooftop storefront name from session / provision (`Dealership.name`).
   * Required for Apex multi-dealer — never fall back to the Merlinus pilot label.
   */
  displayName?: string | null;
  /** Optional dealer / ops code shown under the name. */
  code?: string | null;
}

/**
 * Dealership header branding.
 * - Prefer explicit `displayName` (session.dealershipName after provision).
 * - Apex mode: never show the Tiverton pilot default when name is missing.
 * - Merlinus single-tenant: may use env DEALERSHIP_DISPLAY_NAME for the pilot site only.
 */
export function DealershipBranding({
  size = 'lg',
  className = '',
  displayName,
  code,
}: DealershipBrandingProps) {
  const apex = isApexPlatformMode();
  const resolvedName = (displayName?.trim() || (apex ? '' : DEALERSHIP_DISPLAY_NAME)).trim();
  const resolvedCode = (code?.trim() || (apex ? '' : DEALERSHIP_CODE)).trim();

  const nameClass =
    size === 'lg'
      ? 'text-2xl font-bold tracking-tight text-benz-primary'
      : size === 'md'
        ? 'text-xl font-bold tracking-tight text-benz-primary'
        : 'text-sm font-semibold tracking-tight leading-tight text-benz-primary';

  const codeClass =
    size === 'lg'
      ? 'text-xs text-benz-silver mt-1.5 tracking-[0.28em] font-semibold uppercase'
      : size === 'md'
        ? 'text-xs text-benz-silver mt-1 tracking-[0.2em] font-semibold uppercase'
        : 'text-xs text-benz-muted tracking-[0.16em] font-medium uppercase';

  if (!resolvedName && !resolvedCode) {
    return <div className={`text-center ${className}`} aria-hidden="true" />;
  }

  return (
    <div className={`text-center ${className}`}>
      {resolvedName ? <div className={nameClass}>{resolvedName}</div> : null}
      {resolvedCode ? <div className={codeClass}>{resolvedCode}</div> : null}
    </div>
  );
}
