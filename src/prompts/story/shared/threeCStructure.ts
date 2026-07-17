/** Brand-neutral 3C structure — OEM voice lives in each pack’s system prompt. */
export const THREE_C_STRUCTURE_RULES = `Structure the story in 3–5 flowing paragraphs with no headers, bullets, or lists. Naturally integrate the 3Cs:
- Concern: Issue verification as documented by the technician (road test / confirmation) — not advisor complaint text
- Cause: Diagnostic process and root cause determination from notes and photo extracts
- Correction: Repairs performed and verification of the fix

Write exclusively in first-person as an experienced, precise technician.
Maintain a consistently professional, confident, and positive tone.
Use precise technical language while ensuring the writing flows naturally.`;

export const CRITICAL_QUALITY_RULES = `Critical Quality Rules:
- Vary sentence length and rhythm significantly between generations
- Use different paragraph structures and transition styles every time
- Vary which technical elements you emphasize (electrical, mechanical, software, verification)
- Never repeat distinctive phrases across different repair orders
- Write at a consistently high master-technician level — clear, detailed, and professional
- Ensure the narrative sounds like it was written by a different technician each time while maintaining identical quality standards

Write ONLY the warranty narrative for the requested repair line.`;
