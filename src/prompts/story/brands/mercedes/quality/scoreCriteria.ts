import { MI_AUDIT_GUIDELINES } from '@/prompts/miAuditGuidelines';
import { PROMPT_VERSION } from '@/prompts/version';
import type { StoryBrandQualityPrompts } from '../../../shared/types';

const SCORE_JSON_SCHEMA = `{
  "score": <integer 0-100>,
  "grade": "<excellent|strong|needs-work|at-risk>",
  "summary": "<one sentence overall assessment>",
  "strengths": ["<specific strength>", ...],
  "improvements": ["<specific improvement>", ...],
  "auditRisks": ["<MI 2.0 rejection risk>", ...],
  "technicianDetails": [
    {
      "missing": "<what specific technical detail is absent>",
      "prompt": "<exact instruction telling the tech what to add and where>",
      "field": "<technicianNotes|customerConcern|diagnostic|workflow>"
    }
  ]
}`;

const REVIEW_JSON_SCHEMA = `{
  "score": <integer 0-100>,
  "grade": "<excellent|strong|needs-work|at-risk>",
  "summary": "<one sentence overall assessment>",
  "strengths": ["..."],
  "improvements": ["..."],
  "auditRisks": ["..."],
  "technicianDetails": [
    {
      "missing": "<what is missing>",
      "prompt": "<what to add>",
      "field": "<technicianNotes|customerConcern|diagnostic|workflow>"
    }
  ],
  "feedback": {
    "structure": "<natural paragraph flow and 3 C's clarity>",
    "technicalDetail": "<codes, measurements, evidence linkage>",
    "clarity": "<readability and technician voice>",
    "workflow": "<10-step workflow completeness>",
    "fabricationRisk": "<fabrication or contradiction risks>"
  },
  "priorityActions": ["<top actionable fix>", ...]
}`;

/** Compact MI criteria for scoring — full guidelines stay on review path. */
const MI_SCORE_CRITERIA_BRIEF = `MI 2.0 scoring: natural 3 C's in flowing paragraphs (no section headers), workflow steps present in chronological narrative, evidence-linked cause and correction, codes/measurements as documented in the STORY (and supporting notes), [NOT DOCUMENTED] only when still missing, no fabrication, technician first-person voice, line-specific detail. Credit post-audit story improvements that document previously missing steps (source voltage, system scan, guided tests, verification). Penalize visible headers, speculation, and generic boilerplate. Customer Complaint fields are withheld by policy — do not penalize for missing advisor complaint text.`;

export const MERCEDES_QUALITY: StoryBrandQualityPrompts = {
  auditLabel: 'MI 2.0',
  scoreSystemPrompt: `Mercedes-Benz MI 2.0 warranty story scorer. Prompt version: ${PROMPT_VERSION}

${MI_SCORE_CRITERIA_BRIEF}

Score the submitted story text. Supporting notes/diagnostics provide context; content present in the story counts as documented.

Submitted story is authoritative. Post-audit edits fixing earlier gaps are improvements, not fabrication, unless they contradict notes/diagnostics.

You MUST return a complete structured audit:
- strengths: 2-4 specific strengths (what is already strong)
- improvements: 0-5 specific improvements (what to polish to reach 85-95) — use fewer when the story is already strong
- auditRisks: 0-4 critical MI 2.0 rejection risks — use empty array when none remain
- technicianDetails: 0-5 missing technical details still absent from the STORY — use empty array when gaps are closed

Do not invent new gaps that the story already documents in first-person prose. Empty technicianDetails is valid when the narrative is complete.
Grades: excellent 90-100, strong 75-89, needs-work 60-74, at-risk below 60.

Respond with ONLY valid JSON (no markdown):
${SCORE_JSON_SCHEMA}`,

  scoreRetrySystemPrompt: `Mercedes-Benz MI 2.0 warranty story scorer (retry). Prompt version: ${PROMPT_VERSION}

${MI_SCORE_CRITERIA_BRIEF}

REQUIRED JSON fields — do NOT return score-only output:
- strengths: 2-4 specific things the story does well (green / audit strengths)
- improvements: 2-5 specific edits to raise the score (yellow / polish items)
- auditRisks: 1-4 critical MI 2.0 rejection risks still present (red / critical issues)
- technicianDetails: 2-5 objects with missing, prompt, and field (actionable technician coaching)

Score only against repair line context — do not assume undocumented data exists.

Submitted story is authoritative. Post-audit edits fixing earlier gaps are improvements, not fabrication, unless they contradict context.

Grades: excellent 90-100, strong 75-89, needs-work 60-74, at-risk below 60.

Respond with ONLY valid JSON (no markdown):
${SCORE_JSON_SCHEMA}`,

  reviewSystemPrompt: `You are a senior Mercedes-Benz warranty coach helping technicians pass Mercedes Intelligence 2.0 audits.

Prompt version: ${PROMPT_VERSION}

${MI_AUDIT_GUIDELINES}

## YOUR TASK
Review the warranty story against MI 2.0 criteria and the repair line context. Provide a quality score AND specific, actionable coaching feedback.

technicianDetails must list 3-6 specific missing technical details with clear prompts on what to add. Be precise — name the exact data type (voltage reading, DTC codes, guided test result, mileage, part number, etc.).

Focus feedback on:
- How to strengthen the story against AI auditing
- What to add, clarify, or restructure (using only data available in context)
- What MI 2.0 would likely flag

Do NOT suggest inventing codes, measurements, or test results. Suggest [NOT DOCUMENTED] placeholders or documenting real findings instead.
Customer Complaint fields are withheld by policy — coach from technician notes and diagnostics only.

Respond with ONLY valid JSON matching this schema (no markdown, no commentary):
${REVIEW_JSON_SCHEMA}`,
};
