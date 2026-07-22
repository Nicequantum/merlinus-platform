'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Save, Sparkles, TestTube2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Dept = 'service' | 'parts' | 'sales' | 'loaner' | 'receptionist';

type Customization = {
  id: string | null;
  department: string;
  customInstructions: string;
  greeting: string;
  disclaimers: string;
  toneGuidelines: string;
  version: number;
  updatedAt: string | null;
  isCustomized: boolean;
};

type VersionRow = {
  id: string;
  version: number;
  changeNote: string;
  createdAt: string;
  customInstructions: string;
  greeting: string;
  disclaimers: string;
  toneGuidelines: string;
};

const DEPT_TABS: { id: Dept; label: string }[] = [
  { id: 'service', label: 'Service' },
  { id: 'loaner', label: 'Loaner' },
  { id: 'parts', label: 'Parts' },
  { id: 'sales', label: 'Sales' },
  { id: 'receptionist', label: 'Reception' },
];

/**
 * Manager UI — Settings → AI Voice → Department Tailoring
 */
export function DepartmentTailoringPanel() {
  const [department, setDepartment] = useState<Dept>('service');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [greeting, setGreeting] = useState('');
  const [disclaimers, setDisclaimers] = useState('');
  const [toneGuidelines, setToneGuidelines] = useState('');
  const [version, setVersion] = useState(0);
  const [isCustomized, setIsCustomized] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [previewMessage, setPreviewMessage] = useState(
    'A customer is asking for help — greet them and offer next steps.'
  );
  const [previewReply, setPreviewReply] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async (dept: Dept) => {
    setLoading(true);
    try {
      const data = await api.getVoiceCustomization(dept);
      const c = data.customization as Customization;
      setCustomInstructions(c.customInstructions || '');
      setGreeting(c.greeting || '');
      setDisclaimers(c.disclaimers || '');
      setToneGuidelines(c.toneGuidelines || '');
      setVersion(c.version || 0);
      setIsCustomized(Boolean(c.isCustomized));
      setVersions((data.versions as VersionRow[]) || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load tailoring');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(department);
  }, [department, load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveVoiceCustomization({
        department,
        customInstructions,
        greeting,
        disclaimers,
        toneGuidelines,
      });
      const c = res.customization as Customization;
      setVersion(c.version);
      setIsCustomized(c.isCustomized);
      toast.success(`Saved ${department} tailoring (v${c.version})`);
      await load(department);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset this department to Sophia defaults?')) return;
    setSaving(true);
    try {
      await api.resetVoiceCustomization(department);
      toast.success('Reset to default');
      await load(department);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const restore = async (v: number) => {
    setSaving(true);
    try {
      await api.restoreVoiceCustomization(department, v);
      toast.success(`Restored version ${v}`);
      await load(department);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (department === 'receptionist') {
      toast.message('Preview uses department query — pick Service, Parts, Sales, or Loaner');
      return;
    }
    setPreviewing(true);
    setPreviewReply('');
    try {
      const res = await api.previewVoiceDepartmentQuery(department, previewMessage, {
        customInstructions,
        greeting,
        disclaimers,
        toneGuidelines,
      });
      setPreviewReply(res.speech || '');
      if (res.tailoringActive) {
        toast.message('Preview used your draft tailoring');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="benz-card p-5 mb-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <Sparkles size={18} className="text-benz-blue" />
          <div>
            <div className="font-semibold text-sm tracking-tight">AI Voice · Department Tailoring</div>
            <div className="text-xs text-benz-secondary mt-0.5">
              Personal instructions for Sophia per department · variables:{' '}
              <code className="text-[11px]">{'{dealershipName}'}</code>,{' '}
              <code className="text-[11px]">{'{managerName}'}</code>
            </div>
          </div>
        </div>
        {isCustomized ? (
          <span className="status-pill status-pill-valid shrink-0">Custom active · v{version}</span>
        ) : (
          <span className="status-pill status-pill-warn shrink-0">Defaults</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {DEPT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`secondary-btn h-9 px-3 text-xs font-semibold ${
              department === t.id ? 'ring-2 ring-benz-blue' : ''
            }`}
            onClick={() => setDepartment(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-benz-secondary">Loading…</p>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs text-benz-secondary">
            Greeting preference
            <textarea
              className="benz-input mt-1 w-full min-h-[64px] text-sm"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="e.g. Welcome to {dealershipName} Service — how can I help today?"
              maxLength={4000}
            />
          </label>
          <label className="block text-xs text-benz-secondary">
            Tone guidelines
            <textarea
              className="benz-input mt-1 w-full min-h-[64px] text-sm"
              value={toneGuidelines}
              onChange={(e) => setToneGuidelines(e.target.value)}
              placeholder="e.g. Warm but concise; use first names; never pressure."
              maxLength={4000}
            />
          </label>
          <label className="block text-xs text-benz-secondary">
            Custom instructions
            <textarea
              className="benz-input mt-1 w-full min-h-[120px] text-sm font-mono"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Rooftop-specific policies, hours emphasis, preferred handoff language…"
              maxLength={8000}
            />
          </label>
          <label className="block text-xs text-benz-secondary">
            Mandatory disclaimers
            <textarea
              className="benz-input mt-1 w-full min-h-[64px] text-sm"
              value={disclaimers}
              onChange={(e) => setDisclaimers(e.target.value)}
              placeholder="e.g. We never guarantee same-day appointments without advisor confirmation."
              maxLength={4000}
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="primary-btn h-10 px-4 text-xs font-semibold flex items-center gap-1.5"
              disabled={saving}
              onClick={() => void save()}
            >
              <Save size={14} />
              Save
            </button>
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5"
              disabled={saving}
              onClick={() => void reset()}
            >
              <RotateCcw size={14} />
              Reset default
            </button>
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5"
              onClick={() => setShowHistory((v) => !v)}
            >
              <History size={14} />
              History
            </button>
          </div>

          <div className="border-t border-benz-border/50 pt-3 mt-2 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <TestTube2 size={14} className="text-benz-blue" />
              Preview (test without saving)
            </div>
            <input
              className="benz-input w-full text-sm"
              value={previewMessage}
              onChange={(e) => setPreviewMessage(e.target.value)}
              placeholder="Test customer message…"
            />
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold"
              disabled={previewing}
              onClick={() => void preview()}
            >
              {previewing ? 'Running…' : 'Test this customization'}
            </button>
            {previewReply ? (
              <div className="rounded-lg bg-black/5 px-3 py-2 text-sm leading-relaxed">
                {previewReply}
              </div>
            ) : null}
          </div>

          {showHistory ? (
            <div className="border-t border-benz-border/50 pt-3 space-y-2">
              <div className="text-xs font-semibold">Version history</div>
              {versions.length === 0 ? (
                <p className="text-xs text-benz-muted">No versions yet.</p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-2 text-xs rounded border border-benz-border/40 px-2 py-1.5"
                    >
                      <span>
                        v{v.version} · {v.changeNote || 'Update'} ·{' '}
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        className="secondary-btn h-8 px-2 text-[11px]"
                        onClick={() => void restore(v.version)}
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
