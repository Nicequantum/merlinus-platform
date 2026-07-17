'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TemplateCategory } from '@/types';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (title: string, savedText: string) => void;
  defaultTitle: string;
  defaultCategory: TemplateCategory;
  storyText: string;
  generatedText: string;
  lineDescription: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
  repairOrderId?: string;
  lineId?: string;
}

export function SaveTemplateModal({
  open,
  onClose,
  onSaved,
  defaultTitle,
  defaultCategory,
  storyText,
  generatedText,
  lineDescription,
  vehicleMake,
  vehicleModel,
  codes,
  repairOrderId,
  lineId,
}: SaveTemplateModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState<TemplateCategory>(defaultCategory);
  const [preview, setPreview] = useState(storyText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setCategory(defaultCategory);
    setPreview(storyText);
  }, [open, defaultTitle, defaultCategory, storyText]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const handleSave = async () => {
    if (saving) return;
    const trimmedTitle = title.trim();
    const trimmedPreview = preview.trim();
    if (!trimmedTitle) {
      toast.error('Enter a template title');
      return;
    }
    if (!trimmedPreview) {
      toast.error('Story text cannot be empty');
      return;
    }

    setSaving(true);
    try {
      await api.saveTemplateFromStory({
        title: trimmedTitle,
        category,
        finalText: trimmedPreview,
        generatedText,
        lineDescription,
        vehicleMake,
        vehicleModel,
        codes,
        repairOrderId,
        lineId,
      });
      toast.success(`Template "${trimmedTitle}" saved — Grok will learn from this story`);
      onSaved(trimmedTitle, trimmedPreview);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="benz-modal-overlay z-[120]">
      <div className="benz-modal-panel sm:max-w-xl flex flex-col">
        <div className="benz-modal-header">
          <div>
            <div className="flex items-center gap-2 text-benz-green mb-1">
              <BookmarkPlus size={18} />
              <span className="text-xs uppercase tracking-[0.2em] font-semibold">Save as New Template</span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Grow the Knowledge Base</h2>
            <p className="text-xs text-benz-secondary mt-1">
              Your approved story trains future Grok generations for this dealership.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="benz-icon-btn border border-benz-surface-3 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="benz-label">Template Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="e.g. Blind Spot Assist — S-Class Software Update"
              className="benz-input disabled:opacity-60"
            />
          </div>

          <div>
            <label className="benz-label">Category</label>
            <div className="flex gap-2">
              {(['warranty', 'customer'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => setCategory(value)}
                  className={`benz-tab-btn flex-1 text-sm font-medium disabled:opacity-60 ${
                    category === value ? 'benz-tab-btn-active' : ''
                  }`}
                >
                  {value === 'customer' ? 'Customer Pay' : 'Warranty Claims'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="benz-label">Story Preview (final edits)</label>
            <textarea
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              disabled={saving}
              rows={12}
              className="benz-textarea disabled:opacity-60"
            />
            <p className="benz-hint mt-1.5">
              Grok draft is stored separately so the system learns what you changed.
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-benz-surface-3 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="primary-btn flex-1 h-12 text-sm flex items-center justify-center gap-2 disabled:opacity-60 touch-target"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving template…
              </>
            ) : (
              'Save to library'
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="secondary-btn h-12 px-4 text-sm disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}