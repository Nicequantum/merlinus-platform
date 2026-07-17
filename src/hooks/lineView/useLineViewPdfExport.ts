'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { clientLog } from '@/lib/clientLog';
import { getWarrantyStoryTextareaValue } from '@/lib/lineViewUtils';
import type { RepairLine, RepairOrder } from '@/types';
import { exportWarrantyStoryPdf } from '@/utils/pdfExport';

interface UseLineViewPdfExportInput {
  ro: RepairOrder;
  line: RepairLine;
  technicianName?: string;
  isCustomerPayLine: boolean;
}

export function useLineViewPdfExport({
  ro,
  line,
  technicianName,
  isCustomerPayLine,
}: UseLineViewPdfExportInput) {
  return useCallback(async () => {
    const storyText = getWarrantyStoryTextareaValue(line.id, line.warrantyStory);
    if (!storyText.trim()) {
      toast.error(isCustomerPayLine ? 'No story to export yet' : 'No warranty story to export');
      return;
    }

    try {
      let auditHash: string | undefined;
      let promptVersion: string | undefined;

      try {
        const res = await fetch(`/api/audit-logs/latest?repairLineId=${encodeURIComponent(line.id)}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = (await res.json()) as { hash?: string | null; promptVersion?: string | null };
          auditHash = data.hash ?? undefined;
          promptVersion = data.promptVersion ?? undefined;
        }
      } catch (err) {
        clientLog.warn('Could not fetch audit hash for PDF', err);
      }

      const pdfStartedAt = performance.now();
      exportWarrantyStoryPdf(ro, line, storyText, auditHash, promptVersion, technicianName);
      const durationMs = Math.round(performance.now() - pdfStartedAt);

      void fetch('/api/audit-logs/pdf-export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repairLineId: line.id, repairOrderId: ro.id, durationMs }),
      }).catch((err) => {
        clientLog.warn('Could not record PDF export audit log', err);
      });

      toast.success('PDF downloaded successfully');
    } catch (err) {
      clientLog.error('PDF export failed', err);
      toast.error('PDF export failed — try again');
    }
  }, [ro, line, technicianName, isCustomerPayLine]);
}