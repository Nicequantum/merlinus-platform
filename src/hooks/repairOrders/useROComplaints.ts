'use client';

import { useCallback, type MutableRefObject } from 'react';
import { syncRepairLinesWithComplaints } from '@/utils/repairOrderFactory';
import type { RepairOrder } from '@/types';

interface UseROComplaintsOptions {
  roRef: MutableRefObject<RepairOrder | null>;
  applyROUpdate: (
    updater: (ro: RepairOrder) => RepairOrder,
    options?: { immediate?: boolean }
  ) => RepairOrder | null;
}

/** Complaint list editing and repair-line sync for the active repair order. */
export function useROComplaints({ roRef, applyROUpdate }: UseROComplaintsOptions) {
  const nextComplaintLabel = useCallback((labels?: string[], count = 0) => {
    if (labels && labels.length > 0) {
      const lastCode = labels[labels.length - 1].toUpperCase().charCodeAt(0);
      if (lastCode >= 65 && lastCode < 90) {
        return String.fromCharCode(lastCode + 1);
      }
    }
    return String.fromCharCode(65 + count);
  }, []);

  const updateComplaints = useCallback(
    (newComplaints: string[], newLabels?: string[], newIds?: string[]) => {
      applyROUpdate((ro) => {
        const complaintLabels =
          newLabels && newLabels.length === newComplaints.length ? newLabels : ro.complaintLabels;
        const labelsForIds =
          complaintLabels ?? newComplaints.map((_, i) => String.fromCharCode(65 + i));
        const complaintIds =
          newIds && newIds.length === newComplaints.length
            ? newIds
            : labelsForIds.map((label, i) => ro.complaintIds?.[i] ?? `cmp-${ro.id}-${label}`);
        const updatedLines = syncRepairLinesWithComplaints(ro.repairLines, newComplaints, complaintLabels);
        return { ...ro, complaints: newComplaints, complaintLabels, complaintIds, repairLines: updatedLines };
      });
    },
    [applyROUpdate]
  );

  const addComplaint = useCallback(() => {
    const ro = roRef.current;
    if (!ro) return;
    const complaints = [...(ro.complaints || []), ''];
    const labels = [...(ro.complaintLabels || ro.complaints.map((_, i) => String.fromCharCode(65 + i)))];
    const ids = [...(ro.complaintIds || labels.map((l) => `cmp-${ro.id}-${l}`))];
    const nextLabel = nextComplaintLabel(labels, complaints.length - 1);
    labels.push(nextLabel);
    ids.push(`cmp-${ro.id}-${nextLabel}-${Date.now()}`);
    updateComplaints(complaints, labels, ids);
  }, [nextComplaintLabel, roRef, updateComplaints]);

  const removeComplaint = useCallback(
    (index: number) => {
      const ro = roRef.current;
      if (!ro) return;
      updateComplaints(
        (ro.complaints || []).filter((_, i) => i !== index),
        ro.complaintLabels?.filter((_, i) => i !== index),
        ro.complaintIds?.filter((_, i) => i !== index)
      );
    },
    [roRef, updateComplaints]
  );

  const editComplaint = useCallback(
    (index: number, value: string) => {
      applyROUpdate((ro) => {
        const updated = [...(ro.complaints || [])];
        updated[index] = value;
        const labels = ro.complaintLabels;
        const label = labels?.[index] || String.fromCharCode(65 + index);
        const concern = value || '';
        const prefix = `${label}. `;
        const autoDescription = concern
          ? `${prefix}${concern}`.slice(0, 72)
          : `${label}. (not extracted — tap to edit)`;

        let repairLines = ro.repairLines;
        if (repairLines.length >= updated.length) {
          repairLines = repairLines.map((line, lineIndex) => {
            if (lineIndex !== index) return line;
            const concernChanged = line.customerConcern !== concern;
            const descLooksAuto =
              !line.description ||
              line.description === 'Enter repair description' ||
              line.description === 'New repair item' ||
              line.description.startsWith(`${label}. `) ||
              line.description === line.customerConcern?.slice(0, 60) ||
              line.description === line.customerConcern?.slice(0, 72);
            return {
              ...line,
              lineNumber: index + 1,
              customerConcern: concern,
              description: concernChanged || descLooksAuto ? autoDescription : line.description,
            };
          });
          if (repairLines.length > updated.length) {
            repairLines = repairLines.slice(0, updated.length);
          }
        } else {
          repairLines = syncRepairLinesWithComplaints(repairLines, updated, labels);
        }

        return {
          ...ro,
          complaints: updated,
          complaintLabels: labels,
          complaintIds: ro.complaintIds,
          repairLines,
        };
      });
    },
    [applyROUpdate]
  );

  const updateRONumber = useCallback(
    (roNumber: string) => {
      applyROUpdate((ro) => ({ ...ro, roNumber: roNumber.trim() }));
    },
    [applyROUpdate]
  );

  return {
    addComplaint,
    removeComplaint,
    editComplaint,
    updateRONumber,
  };
}