import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MI_AUDIT_GUIDELINES } from '@/prompts/miAuditGuidelines';
import {
  STORY_REVIEW_SYSTEM_PROMPT,
  STORY_SCORE_SYSTEM_PROMPT,
  extractJsonPayload,
  gradeFromScore,
  isStoryQualityDetailMissing,
  isStoryQualityParseFailure,
  parseStoryQualityResponse,
  pickRicherStoryQuality,
  parseStoryReviewResponse,
} from '@/prompts/storyQuality';

describe('MI 2.0 audit guidelines', () => {
  it('defines audit rewards and rejection triggers', () => {
    assert.match(MI_AUDIT_GUIDELINES, /Mercedes Intelligence 2\.0/i);
    assert.match(MI_AUDIT_GUIDELINES, /Natural 3 C's flow/i);
    assert.match(MI_AUDIT_GUIDELINES, /Visible section headers/i);
    assert.match(MI_AUDIT_GUIDELINES, /Fabricated data/i);
  });

  it('includes MI criteria and technicianDetails in scoring and review prompts', () => {
    assert.match(STORY_SCORE_SYSTEM_PROMPT, /MI 2\.0/i);
    assert.match(STORY_SCORE_SYSTEM_PROMPT, /technicianDetails/i);
    assert.match(STORY_REVIEW_SYSTEM_PROMPT, /technicianDetails/i);
    assert.match(STORY_REVIEW_SYSTEM_PROMPT, /priorityActions/i);
  });
});

describe('story quality parsing', () => {
  it('parses fenced JSON quality response with technicianDetails', () => {
    const result = parseStoryQualityResponse(`\`\`\`json
{
  "score": 87,
  "grade": "strong",
  "summary": "Solid workflow with minor placeholder gaps.",
  "strengths": ["Natural paragraph flow", "Evidence-linked cause"],
  "improvements": ["Add verification drive mileage"],
  "auditRisks": [],
  "technicianDetails": [
    {
      "missing": "Source voltage reading",
      "prompt": "Add the battery source voltage you measured during diagnosis.",
      "field": "technicianNotes"
    }
  ]
}
\`\`\``);
    assert.equal(result.score, 87);
    assert.equal(result.grade, 'strong');
    assert.equal(result.strengths.length, 2);
    assert.equal(result.auditRisks.length, 0);
    assert.equal(result.technicianDetails.length, 1);
    assert.match(result.technicianDetails[0].prompt, /battery source voltage/i);
  });

  it('parses review response with coaching feedback', () => {
    const result = parseStoryReviewResponse(
      JSON.stringify({
        score: 72,
        grade: 'needs-work',
        summary: 'Workflow gaps weaken audit defense.',
        strengths: ['Good technician voice'],
        improvements: ['Document final Quick Test'],
        auditRisks: ['Missing verification drive'],
        technicianDetails: [
          {
            missing: 'Final Quick Test confirmation',
            prompt: 'State whether codes were cleared and no faults returned after repair.',
            field: 'workflow',
          },
        ],
        feedback: {
          structure: 'Natural flow present but cause runs long.',
          technicalDetail: 'Codes cited correctly.',
          clarity: 'Readable narrative.',
          workflow: 'Steps 8-10 need placeholders.',
          fabricationRisk: 'Low — no invented measurements.',
        },
        priorityActions: ['Add [NOT DOCUMENTED] for final Quick Test', 'Tighten cause paragraph'],
      })
    );
    assert.equal(result.score, 72);
    assert.equal(result.priorityActions.length, 2);
    assert.equal(result.technicianDetails.length, 1);
    assert.match(result.feedback.workflow, /Steps 8-10/);
  });

  it('maps grades from score when missing', () => {
    assert.equal(gradeFromScore(92), 'excellent');
    assert.equal(gradeFromScore(80), 'strong');
    assert.equal(gradeFromScore(65), 'needs-work');
    assert.equal(gradeFromScore(45), 'at-risk');
  });

  it('flags parse failures instead of returning a misleading zero score', () => {
    const empty = parseStoryQualityResponse('');
    assert.equal(empty.parseFailed, true);
    assert.equal(empty.score, 0);

    const invalidJson = parseStoryQualityResponse('not json at all');
    assert.equal(invalidJson.parseFailed, true);

    const missingScore = parseStoryQualityResponse(JSON.stringify({ grade: 'strong', summary: 'No score field' }));
    assert.equal(missingScore.parseFailed, true);
  });

  it('parses alternate score field formats', () => {
    const fraction = parseStoryQualityResponse(JSON.stringify({ score: '87/100', summary: 'Good' }));
    assert.equal(fraction.score, 87);
    assert.equal(fraction.parseFailed, false);

    const nested = parseStoryQualityResponse(
      JSON.stringify({ quality: { score: 76 }, summary: 'Nested score object' })
    );
    assert.equal(nested.score, 76);
    assert.equal(nested.parseFailed, false);
  });

  it('extracts JSON wrapped in explanation text', () => {
    const wrapped = `Here is the MI quality assessment for your story.

{
  "score": 81,
  "grade": "strong",
  "summary": "Good workflow coverage.",
  "strengths": ["Natural flow"],
  "improvements": [],
  "auditRisks": [],
  "technicianDetails": []
}

Let me know if you need more detail.`;
    const payload = extractJsonPayload(wrapped);
    const result = parseStoryQualityResponse(payload);
    assert.equal(result.score, 81);
    assert.equal(result.grade, 'strong');
    assert.equal(isStoryQualityParseFailure(result), false);
  });

  it('flags unreadable AI score responses', () => {
    const result = parseStoryQualityResponse('Sorry, I cannot score this story right now.');
    assert.equal(isStoryQualityParseFailure(result), true);
    assert.equal(result.score, 0);
  });

  it('flags prose-only score responses as parse failures to trigger structured retry', () => {
    const result = parseStoryQualityResponse(
      'Assessment complete. The story scores 84/100 with strong workflow coverage.'
    );
    assert.equal(isStoryQualityParseFailure(result), true);
    assert.equal(result.parseFailed, true);
  });

  it('parses alternate field names for strengths, improvements, and audit risks', () => {
    const result = parseStoryQualityResponse(
      JSON.stringify({
        score: 68,
        grade: 'needs-work',
        summary: 'Workflow gaps weaken audit defense.',
        positives: ['Natural paragraph flow', 'Technician voice is clear'],
        suggestions: ['Add final Quick Test confirmation', 'Tighten cause paragraph'],
        criticalIssues: ['Missing verification drive mileage'],
        technician_details: [
          {
            missing: 'Source voltage reading',
            prompt: 'Add the battery source voltage measured during diagnosis.',
            field: 'technicianNotes',
          },
        ],
      })
    );
    assert.equal(result.score, 68);
    assert.equal(result.strengths.length, 2);
    assert.equal(result.improvements.length, 2);
    assert.equal(result.auditRisks.length, 1);
    assert.equal(result.technicianDetails.length, 1);
    assert.equal(isStoryQualityDetailMissing(result), false);
  });

  it('pickRicherStoryQuality prefers the result with coaching detail', () => {
    const sparse = parseStoryQualityResponse(
      JSON.stringify({ score: 72, grade: 'needs-work', summary: 'Sparse.' })
    );
    const rich = parseStoryQualityResponse(
      JSON.stringify({
        score: 70,
        grade: 'needs-work',
        summary: 'Detailed.',
        strengths: ['Good flow'],
        improvements: ['Add Quick Test'],
        auditRisks: ['Missing mileage'],
        technicianDetails: [],
      })
    );
    const picked = pickRicherStoryQuality(sparse, rich);
    assert.equal(picked.improvements.length, 1);
    assert.equal(picked.auditRisks.length, 1);
  });

  it('parses score from array-wrapped JSON responses', () => {
    const result = parseStoryQualityResponse(
      JSON.stringify([
        {
          score: 79,
          grade: 'strong',
          summary: 'Good detail.',
          strengths: [],
          improvements: [],
          auditRisks: [],
          technicianDetails: [],
        },
      ])
    );
    assert.equal(result.score, 79);
    assert.equal(result.parseFailed, false);
  });

  it('parses JSON with trailing commas', () => {
    const result = parseStoryQualityResponse(`{
      "score": 74,
      "grade": "needs-work",
      "summary": "Needs verification step.",
      "strengths": [],
      "improvements": ["Add final Quick Test"],
      "auditRisks": [],
      "technicianDetails": [],
    }`);
    assert.equal(result.score, 74);
    assert.equal(isStoryQualityParseFailure(result), false);
  });
});