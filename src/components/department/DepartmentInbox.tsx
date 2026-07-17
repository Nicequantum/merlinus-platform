'use client';

/**
 * PR-M2 — shared department inbox list + status filters.
 * Parameterized by department; Parts uses this first.
 */

import {
  DEPARTMENT_LABELS,
  DEPARTMENT_REQUEST_STATUSES,
  type DepartmentId,
  type DepartmentRequestStatus,
} from '@/lib/department/constants';
import type { DepartmentRequestSummary } from '@/types';

function statusPillClass(status: string): string {
  switch (status) {
    case 'resolved':
    case 'closed':
      return 'status-pill-valid';
    case 'waiting_customer':
    case 'in_progress':
      return 'status-pill-warn';
    default:
      return 'status-pill-warn';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export interface DepartmentInboxProps {
  department: DepartmentId;
  requests: DepartmentRequestSummary[];
  loading?: boolean;
  statusFilter: 'all' | DepartmentRequestStatus;
  onStatusFilterChange: (status: 'all' | DepartmentRequestStatus) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  emptyLabel?: string;
}

export function DepartmentInbox({
  department,
  requests,
  loading,
  statusFilter,
  onStatusFilterChange,
  onSelect,
  onCreate,
  emptyLabel,
}: DepartmentInboxProps) {
  const counts: Record<string, number> = { all: requests.length };
  for (const s of DEPARTMENT_REQUEST_STATUSES) counts[s] = 0;
  for (const r of requests) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }

  const filtered =
    statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="benz-dashboard-eyebrow">{DEPARTMENT_LABELS[department]} inbox</p>
          <h2 className="benz-page-title text-xl">Customer requests</h2>
          <p className="benz-hint mt-1">
            Track calls and walk-ins — customer, vehicle, and request status in one place.
          </p>
        </div>
        <button type="button" className="primary-btn h-11 px-4 shrink-0" onClick={onCreate}>
          New request
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Request status">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'all'}
          className={`h-9 px-3 rounded-full text-xs font-semibold border ${
            statusFilter === 'all'
              ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
              : 'border-benz-border/60 text-benz-secondary'
          }`}
          onClick={() => onStatusFilterChange('all')}
        >
          All ({counts.all || 0})
        </button>
        {DEPARTMENT_REQUEST_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={statusFilter === status}
            className={`h-9 px-3 rounded-full text-xs font-semibold border ${
              statusFilter === status
                ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
                : 'border-benz-border/60 text-benz-secondary'
            }`}
            onClick={() => onStatusFilterChange(status)}
          >
            {statusLabel(status)} ({counts[status] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="benz-hint">Loading requests…</p>
      ) : filtered.length === 0 ? (
        <p className="benz-hint">{emptyLabel || 'No requests yet.'}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="benz-card w-full text-left p-4 hover:border-benz-blue/40 transition-colors"
                onClick={() => onSelect(item.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm tracking-tight">{item.subject}</div>
                  <span className={`status-pill shrink-0 ${statusPillClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="text-xs text-benz-secondary mt-1">
                  {item.vehicleLabel || '—'}
                  {item.vinLast8 ? ` · …${item.vinLast8}` : ''}
                  {item.customerPhoneLast4 ? ` · …${item.customerPhoneLast4}` : ''}
                  {item.partsLineCount > 0 ? ` · ${item.partsLineCount} part line(s)` : ''}
                </div>
                <div className="text-[11px] text-benz-muted mt-1.5 flex justify-between gap-2">
                  <span>
                    {item.priority} · {item.source}
                    {item.assignedToName ? ` · ${item.assignedToName}` : ''}
                  </span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
