import { LEGAL_DISCLAIMER_VERSION } from '@/types';

const STORAGE_PREFIX = 'merlin.legalDisclaimer';

function storageKey(technicianId: string): string {
  return `${STORAGE_PREFIX}.${technicianId}`;
}

/** Device cache only — gate uses session.legalDisclaimerAt from the database. */
export function cacheLegalDisclaimerLocally(technicianId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(technicianId), LEGAL_DISCLAIMER_VERSION);
  } catch {
    // Non-blocking after server persistence succeeds
  }
}