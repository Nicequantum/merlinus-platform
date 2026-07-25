/**
 * Customer-facing priority findings (ok / recommend / urgent).
 * Shared by fallback report, Grok report post-process, and public viewer.
 */

import {
  isMpiSeverity,
  mpiCategoryLabel,
  type MpiSeverity,
} from '@/lib/videoInspection/mpiCategories';

export type CustomerFindingInput = {
  category: string;
  severity: string;
  note?: string | null;
};

const SEVERITY_HEADINGS: Record<MpiSeverity, string> = {
  urgent: 'Needs attention now (urgent)',
  recommend: 'Recommended soon (recommend)',
  ok: 'Checked OK (ok)',
};

const SEVERITY_ORDER: MpiSeverity[] = ['urgent', 'recommend', 'ok'];

function bulletForFinding(f: CustomerFindingInput): string {
  const cat = mpiCategoryLabel(f.category);
  const note = (f.note || '').trim();
  return note ? `- **${cat}** — ${note}` : `- **${cat}**`;
}

/**
 * Markdown "## Priority findings" section with G/Y/R groups.
 * Empty groups omitted. Returns empty string when no findings.
 */
export function formatPriorityFindingsMarkdown(
  findings: ReadonlyArray<CustomerFindingInput> | null | undefined
): string {
  if (!findings?.length) return '';

  const buckets: Record<MpiSeverity, CustomerFindingInput[]> = {
    urgent: [],
    recommend: [],
    ok: [],
  };
  for (const f of findings) {
    const sev = isMpiSeverity(f.severity) ? f.severity : 'recommend';
    buckets[sev].push(f);
  }

  const parts: string[] = ['## Priority findings', ''];
  let any = false;
  for (const sev of SEVERITY_ORDER) {
    const list = buckets[sev];
    if (list.length === 0) continue;
    any = true;
    parts.push(`### ${SEVERITY_HEADINGS[sev]}`);
    for (const f of list) parts.push(bulletForFinding(f));
    parts.push('');
  }
  if (!any) return '';
  return parts.join('\n').trimEnd();
}

/**
 * Ensure report text contains a Priority findings section when checklist findings exist.
 * If Grok already wrote "## Priority findings", leave report as-is.
 */
export function ensurePriorityFindingsInReport(
  report: string,
  findings: ReadonlyArray<CustomerFindingInput> | null | undefined
): string {
  const body = (report || '').trim();
  const section = formatPriorityFindingsMarkdown(findings);
  if (!section) return body;
  if (/^##\s+Priority findings\b/im.test(body)) return body;

  // Insert after Summary when present; otherwise prepend after first heading block.
  const summaryMatch = body.match(/^(##\s+Summary\b[\s\S]*?)(?=\n##\s+|\s*$)/im);
  if (summaryMatch && summaryMatch.index !== undefined) {
    const end = summaryMatch.index + summaryMatch[0].length;
    return `${body.slice(0, end).trimEnd()}\n\n${section}\n\n${body.slice(end).trimStart()}`.trim();
  }
  return `${section}\n\n${body}`.trim();
}

export function findingsForPrompt(
  findings: ReadonlyArray<CustomerFindingInput> | null | undefined
): string {
  if (!findings?.length) return '(No multipoint checklist findings recorded.)';
  return findings
    .map((f) => {
      const sev = isMpiSeverity(f.severity) ? f.severity : f.severity;
      const note = (f.note || '').trim();
      return `- [${sev}] ${mpiCategoryLabel(f.category)}${note ? `: ${note}` : ''}`;
    })
    .join('\n');
}
