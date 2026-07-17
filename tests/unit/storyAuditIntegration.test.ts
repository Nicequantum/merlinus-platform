import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildAuditRecognizableProse,
  countAppliedCorrectionsPresentInStory,
  detectAuditThemes,
  integrateTechnicianDetailsIntoStory,
  isGapResolvedInStory,
  storyCoversTheme,
  storyHasCorrectionContent,
  toAuditCorrection,
} from '../../src/lib/storyAuditIntegration';
import {
  applyAllTechnicianDetails,
} from '../../src/lib/applyTechnicianDetails';
import {
  reconcileStoryQualityWithAppliedCorrections,
  type StoryQualityResult,
} from '../../src/prompts/storyQuality';
import type { TechnicianDetailPrompt } from '../../src/types';

describe('storyAuditIntegration', () => {
  test('builds first-person workflow prose for voltage gaps', () => {
    const prose = buildAuditRecognizableProse({
      missing: 'Source voltage',
      prompt: 'Add the source voltage reading at the battery',
      field: 'workflow',
    });
    assert.match(prose, /^I checked source voltage/i);
    assert.match(prose, /battery/i);
  });

  test('weaves guided-test detail before repairs, not only as appendix', () => {
    const prior =
      'I road tested the vehicle and confirmed rough idle. I connected XENTRY and performed a Quick Test. I found fault code P0300. I replaced the ignition coils. I cleared codes and completed final verification drive.';
    const details: TechnicianDetailPrompt[] = [
      {
        missing: 'Guided test result',
        prompt: 'Document guided test result showing cylinder 3 misfire elevated',
        field: 'diagnostic',
      },
      {
        missing: 'Source voltage',
        prompt: 'Record source voltage 12.4V at the battery',
        field: 'workflow',
      },
    ];
    const out = integrateTechnicianDetailsIntoStory(prior, details);
    assert.match(out, /P0300/);
    assert.match(out, /12\.4/);
    assert.match(out, /guided diagnostic testing|cylinder 3/i);
    assert.match(out, /source voltage/i);
    assert.ok(out.toLowerCase().indexOf('12.4') < out.toLowerCase().indexOf('final verification'));
    const afterVerify = out.toLowerCase().split('final verification')[1] || '';
    assert.ok(
      !afterVerify.includes('12.4') ||
        out.toLowerCase().indexOf('12.4') < out.toLowerCase().indexOf('final verification')
    );
  });

  test('storyHasCorrectionContent detects integrated prose', () => {
    const c = toAuditCorrection({
      missing: 'Source voltage',
      prompt: '12.4V at battery',
      field: 'workflow',
    })!;
    const story = integrateTechnicianDetailsIntoStory(
      'I road tested the car. I completed final verification drive.',
      [
        {
          missing: 'Source voltage',
          prompt: '12.4V at battery',
          field: 'workflow',
        },
      ]
    );
    assert.equal(storyHasCorrectionContent(story, c), true);
  });

  test('theme detection matches rephrased voltage gaps', () => {
    const themes = detectAuditThemes('Battery B+ voltage reading prior to XENTRY');
    assert.ok(themes.includes('source_voltage'));
  });

  test('isGapResolvedInStory treats rephrased scorer gaps as closed after weave', () => {
    const prior =
      'I road tested the vehicle. I connected XENTRY and performed a Quick Test. I found P0300. I replaced coils. I completed final verification drive.';
    const applied: TechnicianDetailPrompt[] = [
      {
        missing: 'Source voltage',
        prompt: 'Record source voltage 12.6V at the battery before connecting XENTRY',
        field: 'workflow',
      },
      {
        missing: 'Guided test',
        prompt: 'Document guided test result for cylinder 3 misfire',
        field: 'diagnostic',
      },
    ];
    const story = integrateTechnicianDetailsIntoStory(prior, applied);
    assert.ok(storyCoversTheme(story, 'source_voltage'));
    assert.ok(storyCoversTheme(story, 'guided_test'));

    // Scorer rephrases the same themes with different wording
    assert.equal(
      isGapResolvedInStory(
        story,
        {
          missing: 'Battery B+ voltage measurement',
          prompt: 'Add KOEO battery voltage at B+ terminal',
          field: 'workflow',
        },
        applied.map((d) => `${d.missing}: ${d.prompt}`)
      ),
      true
    );
    assert.equal(
      isGapResolvedInStory(
        story,
        {
          missing: 'Focused diagnostic results',
          prompt: 'Include guided testing outcomes for misfire',
          field: 'diagnostic',
        },
        applied.map((d) => `${d.missing}: ${d.prompt}`)
      ),
      true
    );
  });
});

describe('audit score reconciliation after Add All Tech Details', () => {
  test('re-audit raises score and drops rephrased recommendations', () => {
    const priorStory =
      'I road tested the vehicle and confirmed rough idle. I connected XENTRY and performed a Quick Test. I found fault code P0300. I replaced the ignition coils. I cleared codes and completed final verification drive.';

    const coaching: TechnicianDetailPrompt[] = [
      {
        missing: 'Source voltage',
        prompt: 'Add the source voltage reading 12.4V at the battery',
        field: 'workflow',
      },
      {
        missing: 'Guided test result',
        prompt: 'Document guided test result showing cylinder 3 elevated misfire',
        field: 'diagnostic',
      },
      {
        missing: 'Verification mileage',
        prompt: 'Record verification road test mileage in and out',
        field: 'workflow',
      },
    ];

    const patch = applyAllTechnicianDetails(
      { technicianNotes: 'Found P0300 on scan.', customerConcern: '', warrantyStory: priorStory },
      coaching
    );

    assert.ok(patch.warrantyStory);
    assert.ok(patch.technicianNotes);
    assert.match(patch.technicianNotes, /PENDING_AUDIT_CORRECTIONS/);
    assert.match(patch.warrantyStory, /source voltage/i);
    assert.match(patch.warrantyStory, /guided/i);

    // Sticky model: same score + rephrased same gaps (what users were seeing)
    const stickyModel: StoryQualityResult = {
      score: 68,
      grade: 'needs-work',
      strengths: ['Has basic workflow'],
      improvements: [
        'Document battery voltage before connecting diagnostic equipment',
        'Include guided test results for the misfire',
      ],
      auditRisks: ['Missing source voltage documentation may cause MI rejection'],
      technicianDetails: [
        {
          missing: 'Battery voltage at B+',
          prompt: 'Record KOEO battery voltage reading',
          field: 'workflow',
        },
        {
          missing: 'Guided diagnostic outcome',
          prompt: 'Add focused diagnostic / guided test findings',
          field: 'diagnostic',
        },
        {
          missing: 'Road test miles',
          prompt: 'Add final verification drive mileage',
          field: 'workflow',
        },
      ],
      summary: 'Story still missing key technical details.',
    };

    const reconciled = reconcileStoryQualityWithAppliedCorrections(
      stickyModel,
      patch.warrantyStory!,
      patch.technicianNotes!
    );

    assert.ok(
      reconciled.score >= 80,
      `expected score lift to 80+, got ${reconciled.score}`
    );
    assert.ok(
      reconciled.technicianDetails.length < stickyModel.technicianDetails.length,
      `expected fewer technicianDetails, got ${reconciled.technicianDetails.length}`
    );
    assert.ok(
      reconciled.improvements.length < stickyModel.improvements.length,
      'improvements should drop covered themes'
    );
    assert.ok(
      reconciled.auditRisks.length < stickyModel.auditRisks.length,
      'auditRisks should drop covered themes'
    );

    const appliedPresent = countAppliedCorrectionsPresentInStory(
      patch.warrantyStory!,
      coaching.map((d) => `${d.missing}: ${d.prompt}`)
    );
    assert.ok(appliedPresent >= 2, `expected ≥2 applied present, got ${appliedPresent}`);
  });
});
