'use client';

import { Settings } from 'lucide-react';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { DealershipBranding } from '@/components/DealershipBranding';

interface AppHeaderProps {
  technicianName?: string;
  /** Session dealership / rooftop name from provision — never the pilot env default. */
  dealershipName?: string | null;
  onOpenSettings: () => void;
}

export function AppHeader({ technicianName, dealershipName, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="benz-header px-4 py-3 flex items-center justify-between sticky top-0 z-50">
      <ApexLogoMark size="sm" title="Apex" />
      <div className="flex-1 min-w-0 px-2">
        <DealershipBranding size="sm" displayName={dealershipName} />
        {technicianName && (
          <p className="text-xs text-benz-muted text-center truncate mt-1 font-medium">{technicianName}</p>
        )}
      </div>
      <button onClick={onOpenSettings} className="benz-icon-btn shrink-0 w-10 h-10 flex items-center justify-center">
        <Settings size={20} />
      </button>
    </header>
  );
}
