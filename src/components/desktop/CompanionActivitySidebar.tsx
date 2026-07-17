'use client';

import { Activity } from 'lucide-react';
import type { CompanionActivityEntry } from '@/lib/companionSyncTypes';

interface CompanionActivitySidebarProps {
  activities: CompanionActivityEntry[];
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function CompanionActivitySidebar({ activities }: CompanionActivitySidebarProps) {
  return (
    <aside className="benz-companion-activity">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={16} className="text-benz-blue" />
        <h2 className="text-sm font-semibold text-benz-primary tracking-tight">Live Activity</h2>
      </div>
      {activities.length === 0 ? (
        <p className="text-xs text-benz-secondary leading-relaxed">
          Actions from your tablet will appear here in real time.
        </p>
      ) : (
        <ul className="space-y-3">
          {activities.map((entry) => (
            <li key={entry.id} className="benz-companion-activity-item">
              <div className="text-xs text-benz-muted font-mono">{formatTime(entry.timestamp)}</div>
              <div className="text-sm text-benz-primary font-medium leading-snug mt-0.5">{entry.label}</div>
              {entry.detail && (
                <div className="text-xs text-benz-secondary mt-1 leading-relaxed">{entry.detail}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}