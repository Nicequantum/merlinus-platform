export type CustomerVideoReportInput = {
  transcript: string;
  transcriptLanguage?: string | null;
  vehicleLabel?: string | null;
  dealershipName?: string | null;
  title?: string | null;
  frameCount: number;
};

export function buildCustomerVideoReportUserMessage(input: CustomerVideoReportInput): string {
  const transcript = (input.transcript || '').trim() || '[No spoken narration provided]';
  const lang = (input.transcriptLanguage || 'en').trim().toLowerCase();
  const languageNote =
    lang && lang !== 'en'
      ? `Technician narration language: ${lang}. Translate meaning into professional English for the customer report.`
      : 'Technician narration language: English.';

  return `Write a customer-facing video inspection report from the technician narration and inspection still frames attached to this message.

Dealership: ${input.dealershipName?.trim() || 'Service department'}
Inspection title: ${input.title?.trim() || 'Video inspection'}
Vehicle: ${input.vehicleLabel?.trim() || 'Not specified'}
Still frames attached: ${input.frameCount}
${languageNote}

===TECHNICIAN_NARRATION===
${transcript.slice(0, 12_000)}
===END_TECHNICIAN_NARRATION===

Analyze the still frames for visible wear, damage, leaks, tire condition, and other customer-relevant issues.
Combine what you see with the narration. Do not invent findings.
Output the report in English using the required section headings.`;
}
