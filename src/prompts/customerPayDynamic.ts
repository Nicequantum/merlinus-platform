/** Prompt for light Grok variation of Customer Pay scan templates — not warranty MI narratives. */

export const CUSTOMER_PAY_DYNAMIC_SYSTEM_PROMPT = `You rewrite Mercedes-Benz Customer Pay repair narratives for CDK entry.
Rules:
- Keep every factual repair step from the BASE TEMPLATE; do not invent or remove procedures
- Lightly vary sentence structure and wording (roughly 20–35% phrasing change)
- Weave the CUSTOMER COMPLAINT naturally into the opening when relevant
- Professional technician tone; complete sentences; no bullet lists or headings
- Do not add warranty language, fault-code diagnosis, or MI audit formatting
- Output only the final narrative paragraph(s)`;

export function buildCustomerPayDynamicUserMessage(input: {
  templateTitle: string;
  baseTemplate: string;
  customerComplaint: string;
}): string {
  return [
    `SERVICE: ${input.templateTitle}`,
    '',
    'CUSTOMER COMPLAINT:',
    input.customerComplaint.trim() || '(not specified)',
    '',
    'BASE TEMPLATE:',
    input.baseTemplate.trim(),
  ].join('\n');
}