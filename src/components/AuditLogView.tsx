'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, ScrollText, SearchX, ShieldCheck } from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { toast } from 'sonner';
import { api, type TechnicianUser } from '@/lib/api';
import type { AuditDashboardSummary, AuditLogEntry, TechnicianSession } from '@/types';
import { formatAuditMetadataForDisplay } from '@/lib/auditMetadataDisplay';
import { AUDIT_ACTIONS } from '@/types';

interface AuditLogViewProps {
  session: TechnicianSession;
  onBack: () => void;
}

export function AuditLogView({ session, onBack }: AuditLogViewProps) {
  const [users, setUsers] = useState<TechnicianUser[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [summary, setSummary] = useState<AuditDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [technicianId, setTechnicianId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const { users: list } = await api.listUsers();
      setUsers(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load technicians');
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const data = await api.getAuditSummary();
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load audit summary');
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { logs: entries } = await api.listAuditLogs({
        technicianId: technicianId || undefined,
        action: action || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      });
      setLogs(entries);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [technicianId, action, from, to]);

  useEffect(() => {
    if (session.role === 'manager') {
      loadUsers();
      loadSummary();
    }
  }, [session.role, loadUsers, loadSummary]);

  useEffect(() => {
    if (session.role === 'manager') {
      loadLogs();
    }
  }, [session.role, loadLogs]);

  const handleExport = () => {
    const url = api.exportAuditLogsCsv({
      technicianId: technicianId || undefined,
      action: action || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    });
    window.open(url, '_blank');
  };

  if (session.role !== 'manager') {
    return (
      <div className="benz-page">
        <button onClick={onBack} className="benz-nav-back">
          <ArrowLeft size={18} /> Back
        </button>
        <p className="text-sm text-benz-secondary">Manager access required.</p>
      </div>
    );
  }

  const chain = summary?.chain;

  return (
    <div className="benz-page">
      <button onClick={onBack} className="benz-nav-back">
        <ArrowLeft size={18} /> Back
      </button>

      <div className="benz-section-header">
        <div className="flex items-center gap-2.5">
          <ScrollText size={22} className="text-benz-blue" />
          <h2 className="benz-page-title mb-0">Audit Log</h2>
        </div>
        <button onClick={handleExport} className="secondary-btn h-10 px-4 flex items-center gap-2 text-xs shrink-0">
          <Download size={14} /> CSV
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <div className="stat-card p-3.5 text-center">
            <div className="text-xl font-bold tracking-tight">{summary.totalEntries}</div>
            <div className="text-xs text-benz-secondary mt-0.5">Total</div>
          </div>
          <div className="stat-card p-3.5 text-center">
            <div className="text-xl font-bold tracking-tight">{summary.last24Hours}</div>
            <div className="text-xs text-benz-secondary mt-0.5">24 hours</div>
          </div>
          <div className="stat-card p-3.5 text-center">
            <div className="text-xl font-bold tracking-tight">{summary.last7Days}</div>
            <div className="text-xs text-benz-secondary mt-0.5">7 days</div>
          </div>
        </div>
      )}

      {chain && (
        <div className="benz-card p-4 mb-5 border-l-4 border-l-benz-accent">
          <div className="flex items-start gap-2.5 mb-2">
            <ShieldCheck
              size={18}
              className={`mt-0.5 shrink-0 ${chain.valid ? 'text-benz-green' : 'text-benz-amber'}`}
            />
            <div>
              <div className="font-semibold text-sm tracking-tight">
                Tamper-evident hash chain — {chain.valid ? 'integrity verified' : 'integrity check failed'}
              </div>
              <p className="text-xs text-benz-secondary mt-1 leading-relaxed">{chain.description}</p>
            </div>
          </div>
          <ul className="text-xs text-benz-muted space-y-1 mt-3 list-disc pl-4">
            {chain.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {chain.headHash && (
            <div className="text-xs text-benz-secondary font-mono mt-3 break-all">
              Chain head: {chain.headHash.slice(0, 24)}…
            </div>
          )}
        </div>
      )}

      {summary && summary.actionCounts.length > 0 && (
        <div className="benz-card p-4 mb-5">
          <div className="benz-section-title mb-3">Top Actions (7 days)</div>
          <div className="space-y-2.5">
            {summary.actionCounts.slice(0, 6).map((item) => (
              <div key={item.action} className="flex justify-between text-sm">
                <span className="text-benz-silver">{item.action}</span>
                <span className="text-benz-secondary font-medium">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="benz-card p-4 mb-5 grid grid-cols-1 gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="benz-input text-sm">
            <option value="">All technicians</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="benz-input text-sm">
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="benz-input text-sm"
          />
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="benz-input text-sm"
          />
        </div>
        <button onClick={loadLogs} className="primary-btn h-11 text-sm touch-target">
          Apply filters
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-sm text-benz-secondary">
          <div className="loading-spinner w-5 h-5" aria-hidden="true" />
          Loading audit entries...
        </div>
      ) : logs.length === 0 ? (
        <BenzEmptyState
          icon={SearchX}
          title="No audit entries match your filters"
          hint="Try widening the date range or clearing technician and action filters."
          compact
        />
      ) : (
        <div className="space-y-2.5">
          {logs.map((log) => (
            <div key={log.id} className="benz-card p-3.5">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-sm font-semibold tracking-tight">{log.action}</div>
                  <div className="text-xs text-benz-secondary mt-1">
                    {log.technicianName || 'System'} · {new Date(log.createdAt).toLocaleString()}
                  </div>
                  {(log.entityType || log.entityId) && (
                    <div className="text-xs text-benz-muted mt-1">
                      {log.entityType || 'entity'} {log.entityId || ''}
                    </div>
                  )}
                  {log.entryHash && (
                    <div className="text-xs text-benz-muted font-mono mt-1">hash {log.entryHash.slice(0, 16)}…</div>
                  )}
                  {log.promptVersion && (
                    <div className="text-xs text-benz-muted mt-1">prompt {log.promptVersion}</div>
                  )}
                  {formatAuditMetadataForDisplay(log.metadata).length > 0 && (
                    <ul className="text-xs text-benz-secondary mt-2 space-y-0.5 list-none">
                      {formatAuditMetadataForDisplay(log.metadata).map((line) => (
                        <li key={line} className="font-mono break-all">
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {log.ipAddress && <div className="text-xs text-benz-muted font-mono">{log.ipAddress}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}