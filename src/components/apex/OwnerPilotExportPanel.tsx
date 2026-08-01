'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

type ManifestPayload = {
  ok?: boolean;
  meta?: { schemaVersion?: string; dealershipIds?: string[] };
  data?: Array<{ id: string; title: string; description: string; pii: string; path: string }>;
  payload?: { authentication?: string[]; rooftopCountInScope?: number };
  error?: string;
};

/**
 * National console — pilot data export for GCP migration partners.
 * Owners can preview manifest; partners use PILOT_EXPORT_TOKEN server-side.
 */
export function OwnerPilotExportPanel() {
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState<ManifestPayload | null>(null);
  const [dataset, setDataset] = useState('topology');
  const [preview, setPreview] = useState<string>('');

  const loadManifest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/export/pilot', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json()) as ManifestPayload;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setManifest(body);
      toast.success('Export catalog loaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load export catalog');
      setManifest(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDataset = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/export/pilot/${encodeURIComponent(dataset)}?limit=25`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      setPreview(JSON.stringify(body, null, 2));
      toast.success(`Loaded ${dataset}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
      setPreview('');
    } finally {
      setLoading(false);
    }
  }, [dataset]);

  const downloadPreview = () => {
    if (!preview) return;
    const blob = new Blob([preview], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pilot-export-${dataset}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="apex-card apex-card-accent space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Pilot data export (GCP migration)
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Share a dedicated <code className="text-[11px]">PILOT_EXPORT_TOKEN</code> with your Google
          Cloud team. They pull topology, usage, audit, health, provision, and more — never
          passwords, story text, or customer PII. Full guide:{' '}
          <span className="font-medium">docs/PILOT-DATA-EXPORT.md</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white touch-target dark:bg-teal-700"
          disabled={loading}
          onClick={() => void loadManifest()}
        >
          {loading ? 'Loading…' : 'Load catalog'}
        </button>
        <select
          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900"
          value={dataset}
          onChange={(e) => setDataset(e.target.value)}
        >
          {(
            manifest?.data?.map((d) => d.id) || [
              'platform',
              'topology',
              'staff',
              'usage',
              'audit',
              'provision',
              'health',
              'billing',
            ]
          ).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium touch-target dark:border-slate-600"
          disabled={loading}
          onClick={() => void loadDataset()}
        >
          Preview dataset
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium touch-target dark:border-slate-600"
          disabled={!preview}
          onClick={downloadPreview}
        >
          Download JSON
        </button>
      </div>

      {manifest?.meta ? (
        <p className="text-[11px] text-slate-600 dark:text-slate-300">
          Schema {manifest.meta.schemaVersion} · rooftops in scope:{' '}
          {manifest.payload?.rooftopCountInScope ?? manifest.meta.dealershipIds?.length ?? '—'}
        </p>
      ) : null}

      {manifest?.data?.length ? (
        <ul className="grid gap-1 text-[11px] sm:grid-cols-2">
          {manifest.data.map((d) => (
            <li
              key={d.id}
              className="rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700"
            >
              <span className="font-semibold">{d.id}</span>
              <span className="text-slate-500"> · {d.pii}</span>
              <div className="text-slate-600 dark:text-slate-400">{d.description}</div>
            </li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-100">
          {preview.slice(0, 12000)}
          {preview.length > 12000 ? '\n… truncated in UI — download for full page' : ''}
        </pre>
      ) : null}
    </div>
  );
}
