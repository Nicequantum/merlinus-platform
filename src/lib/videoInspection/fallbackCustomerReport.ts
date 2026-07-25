/**
 * Deterministic customer report when Grok is unavailable or fails.
 * Keeps the post-recording pipeline working without inventing findings.
 */

import {
  formatPriorityFindingsMarkdown,
  type CustomerFindingInput,
} from '@/lib/videoInspection/priorityFindings';

export function buildFallbackCustomerVideoReport(input: {
  transcript?: string | null;
  vehicleLabel?: string | null;
  dealershipName?: string | null;
  title?: string | null;
  frameCount?: number;
  findings?: ReadonlyArray<CustomerFindingInput> | null;
}): string {
  const dealership = (input.dealershipName || 'Your service team').trim();
  const vehicle = (input.vehicleLabel || 'your vehicle').trim();
  const title = (input.title || 'Video multipoint inspection').trim();
  const transcript = (input.transcript || '').trim();
  const frames = input.frameCount ?? 0;

  const narrativeBlock = transcript
    ? transcript
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 12)
        .map((s) => `- ${s}`)
        .join('\n')
    : frames > 0
      ? '- Your technician recorded a video walkthrough of the vehicle.\n- Written notes were limited; please review the video for full detail.'
      : '- A video multipoint inspection was completed and saved for your records.\n- Detailed spoken notes were limited on this visit.';

  const priority = formatPriorityFindingsMarkdown(input.findings);
  const hasUrgent = (input.findings || []).some((f) => f.severity === 'urgent');

  const sections = [
    '## Summary',
    `${dealership} completed a ${title.toLowerCase()} for ${vehicle}. Below is a clear overview of what was noted, along with practical next steps. Please also watch the attached video for the full walkthrough.`,
    '',
  ];

  if (priority) {
    sections.push(priority, '');
  }

  sections.push(
    '## What We Found',
    narrativeBlock,
    '',
    '## Recommended Next Steps',
    '1. Review the video walkthrough included with this report.',
    hasUrgent
      ? '2. Address items listed under “Needs attention now” promptly — schedule service as soon as practical.'
      : '2. If anything safety-related was mentioned (brakes, tires, leaks, warning lights), schedule service promptly.',
    '3. Contact the dealership service department with questions — we are happy to walk through findings with you.',
    '',
    '## Closing',
    `Thank you for trusting ${dealership}. We appreciate the opportunity to care for your vehicle.`
  );

  return sections.join('\n');
}
