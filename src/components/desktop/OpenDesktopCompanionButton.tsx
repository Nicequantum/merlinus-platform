'use client';

import { MonitorSmartphone } from 'lucide-react';
import { toast } from 'sonner';
import { buildDesktopDeepLink } from '@/lib/desktopLayoutPrefs';

interface OpenDesktopCompanionButtonProps {
  roId?: string | null;
  lineId?: string | null;
  view?: string | null;
  className?: string;
}

/**
 * Tablet CTA: copy a deep link for the desktop command center on the same dealership session.
 */
export function OpenDesktopCompanionButton({
  roId,
  lineId,
  view,
  className = '',
}: OpenDesktopCompanionButtonProps) {
  const onClick = async () => {
    const href = buildDesktopDeepLink({ roId, lineId, view: view || undefined });
    try {
      await navigator.clipboard.writeText(href);
      toast.success('Desktop link copied — open it on your workstation browser');
    } catch {
      toast.message(href);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={`secondary-btn h-10 px-3 text-xs font-semibold inline-flex items-center gap-1.5 ${className}`}
      title="Copy deep link for Desktop Companion (same login / dealership)"
    >
      <MonitorSmartphone size={14} />
      Open in Desktop Companion
    </button>
  );
}
