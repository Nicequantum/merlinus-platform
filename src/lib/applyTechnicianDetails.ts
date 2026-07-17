import type { RepairLine, TechnicianDetailPrompt } from '@/types';
import { AUDIT_ENHANCEMENT_NOTES_MARKER } from '@/prompts/story/shared/regenerateRules';
import { mergePendingCorrectionsIntoNotes } from '@/lib/storyRegenerateGuard';
import {
  appendUniqueDetailText,
  formatTechnicianDetailForStory,
  formatTechnicianDetailInsert,
} from '@/lib/storyDetailText';
import {
  integrateTechnicianDetailsIntoStory,
  toAuditCorrection,
} from '@/lib/storyAuditIntegration';

export type TechnicianDetailFieldPatch = Partial<
  Pick<RepairLine, 'technicianNotes' | 'customerConcern' | 'warrantyStory'>
>;

export {
  appendUniqueDetailText,
  formatTechnicianDetailForStory,
  formatTechnicianDetailInsert,
} from '@/lib/storyDetailText';

function fieldPrefix(field: TechnicianDetailPrompt['field']): string {
  if (field === 'diagnostic') return '[Diagnostic] ';
  if (field === 'workflow') return '[Workflow] ';
  return '';
}

/**
 * Apply one audit coaching item into notes + story.
 * Story integration is workflow-aware (not a trailing dump).
 */
export function applyTechnicianDetail(
  line: Pick<RepairLine, 'technicianNotes' | 'customerConcern' | 'warrantyStory'>,
  detail: TechnicianDetailPrompt
): TechnicianDetailFieldPatch {
  const notesBody = formatTechnicianDetailInsert(detail);
  const correction = toAuditCorrection(detail);
  if (!notesBody && !correction) return {};

  const patch: TechnicianDetailFieldPatch = {};

  if (detail.field === 'customerConcern' && notesBody) {
    patch.customerConcern = appendUniqueDetailText(line.customerConcern || '', notesBody);
  } else if (notesBody) {
    const tagged = `${AUDIT_ENHANCEMENT_NOTES_MARKER} ${fieldPrefix(detail.field)}${notesBody}`;
    patch.technicianNotes = appendUniqueDetailText(line.technicianNotes || '', tagged);
  }

  if (correction) {
    patch.warrantyStory = integrateTechnicianDetailsIntoStory(line.warrantyStory || '', [detail]);
  }

  const notesBase = patch.technicianNotes ?? line.technicianNotes ?? '';
  patch.technicianNotes = mergePendingCorrectionsIntoNotes(notesBase, [detail]);

  return patch;
}

/** Apply every coaching item; story is fully re-woven for audit recognition. */
export function applyAllTechnicianDetails(
  line: Pick<RepairLine, 'technicianNotes' | 'customerConcern' | 'warrantyStory'>,
  details: TechnicianDetailPrompt[]
): TechnicianDetailFieldPatch {
  let notes = line.technicianNotes || '';
  let concern = line.customerConcern || '';

  for (const detail of details) {
    const notesBody = formatTechnicianDetailInsert(detail);
    if (detail.field === 'customerConcern' && notesBody) {
      concern = appendUniqueDetailText(concern, notesBody);
    } else if (notesBody) {
      const tagged = `${AUDIT_ENHANCEMENT_NOTES_MARKER} ${fieldPrefix(detail.field)}${notesBody}`;
      notes = appendUniqueDetailText(notes, tagged);
    }
  }

  notes = mergePendingCorrectionsIntoNotes(notes, details);

  // Single weave pass for the full story — correct workflow placement for each detail.
  const story = integrateTechnicianDetailsIntoStory(line.warrantyStory || '', details);

  const result: TechnicianDetailFieldPatch = {};
  if (notes !== (line.technicianNotes || '')) result.technicianNotes = notes;
  if (concern !== (line.customerConcern || '')) result.customerConcern = concern;
  if (story !== (line.warrantyStory || '')) result.warrantyStory = story;
  return result;
}

export function technicianDetailActionLabel(field: TechnicianDetailPrompt['field']): string {
  switch (field) {
    case 'technicianNotes':
      return 'Add to Story + Notes';
    case 'customerConcern':
      return 'Add to Story + Concern';
    case 'diagnostic':
      return 'Add Diagnostic to Story';
    case 'workflow':
      return 'Add Workflow to Story';
    default:
      return 'Add to Story';
  }
}
