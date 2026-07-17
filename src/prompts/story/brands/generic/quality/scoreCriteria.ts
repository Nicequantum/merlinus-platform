import { PROMPT_VERSION } from '@/prompts/version';
import type { StoryBrandQualityPrompts } from '../../../shared/types';

const SCORE_JSON_SCHEMA = `{
  "score": <integer 0-100>,
  "grade": "<excellent|strong|needs-work|at-risk>",
  "summary": "<one sentence overall assessment>",
  "strengths": ["<specific strength>", ...],
  "improvements": ["<specific improvement>", ...],
  "auditRisks": ["<warranty audit rejection risk>", ...],
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

const GENERIC_SCORE_CRITERIA = `Brand-neutral warranty scoring: natural 3 C's in flowing paragraphs (no section headers), all 10 generic workflow steps in order when documented, evidence-linked cause and correction, exact codes/measurements from context only, [NOT DOCUMENTED] for gaps, no fabrication, technician first-person voice, line-specific detail. Do NOT require brand-specific OEM diagnostic product names. Penalize speculation and generic boilerplate. Customer Complaint fields are withheld by policy.`;

export const GENERIC_QUALITY: StoryBrandQualityPrompts = {
  auditLabel: 'warranty audit',
  scoreSystemPrompt: `Brand-neutral warranty story scorer. Prompt version: ${PROMPT_VERSION}

${GENERIC_SCORE_CRITERIA}

Score only against repair line context — do not assume undocumented data exists.

Submitted story is authoritative. Post-audit edits fixing earlier gaps are improvements, not fabrication, unless they contradict context.

You MUST return a complete structured audit:
- strengths: 2-4 specific strengths
- improvements: 2-5 specific improvements
- auditRisks: 1-4 critical warranty audit rejection risks
- technicianDetails: 2-5 missing technical details with exact add instructions and field

Empty arrays are invalid. Cite workflow steps, codes, measurements, or missing evidence from the story.
Grades: excellent 90-100, strong 75-89, needs-work 60-74, at-risk below 60.

Respond with ONLY valid JSON (no markdown):
${SCORE_JSON_SCHEMA}`,

  scoreRetrySystemPrompt: `Brand-neutral warranty story scorer (retry). Prompt version: ${PROMPT_VERSION}

${GENERIC_SCORE_CRITERIA}

REQUIRED JSON fields — do NOT return score-only output:
- strengths: 2-4 specific things the story does well
- improvements: 2-5 specific edits to raise the score
- auditRisks: 1-4 warranty audit rejection risks still present
- technicianDetails: 2-5 objects with missing, prompt, and field

Score only against repair line context — do not assume undocumented data exists.

Grades: excellent 90-100, strong 75-89, needs-work 60-74, at-risk below 60.

Respond with ONLY valid JSON (no markdown):
${SCORE_JSON_SCHEMA}`,

  reviewSystemPrompt: `You are a senior warranty coach helping technicians write audit-defensible, brand-neutral repair narratives.

Prompt version: ${PROMPT_VERSION}

## CRITERIA
- Natural 3 C's (Concern / Cause / Correction) in flowing paragraphs
- Documented diagnostic workflow without inventing OEM-specific tools
- Codes and measurements only from technician notes and diagnostic photo extracts
- [NOT DOCUMENTED] for gaps — never invent
- Professional first-person technician voice

## YOUR TASK
Review the warranty story against the repair line context. Provide a quality score AND specific, actionable coaching feedback.

technicianDetails must list 3-6 specific missing technical details with clear prompts on what to add.

Do NOT suggest inventing codes, measurements, or test results. Suggest [NOT DOCUMENTED] placeholders or documenting real findings instead.
Customer Complaint fields are withheld by policy — coach from technician notes and diagnostics only.
Do NOT require brand-specific diagnostic product names.

Respond with ONLY valid JSON matching this schema (no markdown, no commentary):
${REVIEW_JSON_SCHEMA}`,
};
