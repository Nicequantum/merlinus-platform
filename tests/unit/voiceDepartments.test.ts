import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  VOICE_DEPARTMENT_MODULE_IDS,
  VOICE_DEPARTMENT_TO_MODULE,
  voiceDepartmentFromModuleId,
  DEMO_SEED_MODULE_IDS,
  PRODUCT_MODULE_IDS,
} from '@/lib/modules/catalog';
import { classifyVoiceIntent } from '@/lib/voiceAgent/intentClassifier';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Sophia multi-department voice', () => {
  it('catalog includes department voice SKUs', () => {
    assert.ok(PRODUCT_MODULE_IDS.includes('voice_agent_service'));
    assert.ok(PRODUCT_MODULE_IDS.includes('voice_agent_loaner'));
    assert.ok(PRODUCT_MODULE_IDS.includes('voice_agent_parts'));
    assert.ok(PRODUCT_MODULE_IDS.includes('voice_agent_sales'));
    assert.equal(VOICE_DEPARTMENT_TO_MODULE.service, 'voice_agent_service');
    assert.equal(voiceDepartmentFromModuleId('voice_agent_loaner'), 'loaner');
    assert.ok(DEMO_SEED_MODULE_IDS.includes('voice_agent_service'));
    assert.ok(DEMO_SEED_MODULE_IDS.includes('voice_agent_loaner'));
    assert.equal(VOICE_DEPARTMENT_MODULE_IDS.length, 4);
  });

  it('intent classifier routes service and loaner', () => {
    const service = classifyVoiceIntent({
      utterance: 'I need a service appointment for oil change',
      enabledDepartments: ['service', 'loaner', 'parts', 'sales'],
    });
    assert.equal(service.department, 'service');
    assert.ok(service.confidence >= 0.5);

    const loaner = classifyVoiceIntent({
      utterance: 'Do you have a loaner or courtesy car available?',
      enabledDepartments: ['service', 'loaner'],
    });
    assert.equal(loaner.department, 'loaner');

    const preferred = classifyVoiceIntent({
      utterance: 'help',
      preferredDepartment: 'loaner',
      enabledDepartments: ['loaner'],
    });
    assert.equal(preferred.department, 'loaner');

    const escalate = classifyVoiceIntent({
      utterance: 'I want to speak to a manager right now',
      preferredDepartment: 'service',
      enabledDepartments: ['service'],
    });
    assert.equal(escalate.escalate, true);
  });

  it('department query engine + API route exist', () => {
    assert.match(readSrc('src/lib/voiceAgent/departmentQuery.ts'), /runDepartmentQuery/);
    assert.match(readSrc('src/lib/voiceAgent/departmentQuery.ts'), /list_available_loaners/);
    assert.match(
      readSrc('src/app/api/voice/[department]/query/route.ts'),
      /text\/event-stream/
    );
    assert.match(readSrc('src/lib/modules/entitlements.ts'), /assertVoiceDepartmentEnabled|applyVoiceDepartmentGates/);
  });

  it('UX panel wired to service + loaner surfaces', () => {
    assert.match(readSrc('src/components/voice/DepartmentVoicePanel.tsx'), /DepartmentVoicePanel/);
    assert.match(readSrc('src/components/loaner/LoanerDashboard.tsx'), /department="loaner"/);
    assert.match(
      readSrc('src/components/department/DepartmentRequestDashboard.tsx'),
      /DepartmentVoicePanel/
    );
  });

  it('health checks include voice departments', () => {
    assert.match(readSrc('src/lib/healthChecks.ts'), /checkVoiceDepartmentHealth/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /voiceDepartments/);
  });

  it('schema ModuleId includes department voice enums', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.match(schema, /voice_agent_service/);
    assert.match(schema, /voice_agent_loaner/);
  });

  it('personal tailoring model + injection helpers', () => {
    assert.match(readSrc('prisma/schema.prisma'), /model DepartmentCustomization/);
    assert.match(readSrc('prisma/schema.prisma'), /DepartmentCustomizationVersion/);
    const cust = readSrc('src/lib/voiceAgent/customization.ts');
    assert.match(cust, /applyCustomizationVariables/);
    assert.match(cust, /buildTailoringPromptBlock/);
    assert.match(cust, /invalidateCustomizationCache/);
    assert.match(
      readSrc('src/lib/voiceAgent/departmentQuery.ts'),
      /buildTailoringPromptBlock|previewTailoring/
    );
    assert.match(readSrc('src/app/api/voice/customizations/route.ts'), /requireManager/);
    assert.match(
      readSrc('src/components/voice/DepartmentTailoringPanel.tsx'),
      /Department Tailoring|Test this customization/
    );
  });

  it('parts and sales tools are department-complete', () => {
    const tools = readSrc('src/lib/voiceAgent/tools.ts');
    assert.match(tools, /lookup_parts_guidance/);
    assert.match(tools, /note_sales_interest/);
    assert.match(tools, /preferredVisitWindow|interestType/);
    const prompt = readSrc('src/lib/voiceAgent/sophiaPrompt.ts');
    assert.match(prompt, /inventory \/ ordering/);
    assert.match(prompt, /quotes \/ availability/);
    const dq = readSrc('src/lib/voiceAgent/departmentQuery.ts');
    assert.match(dq, /lookup_parts_guidance/);
    assert.match(dq, /note_sales_interest/);
  });
});

describe('Personal Tailoring variables', () => {
  it('substitutes dealership and manager variables', async () => {
    const { applyCustomizationVariables, buildTailoringPromptBlock } = await import(
      '@/lib/voiceAgent/customization'
    );
    const text = applyCustomizationVariables(
      'Welcome to {dealershipName}, ask for {managerName}.',
      { dealershipName: 'Viti MB', managerName: 'Alex' }
    );
    assert.equal(text, 'Welcome to Viti MB, ask for Alex.');
    const block = buildTailoringPromptBlock(
      {
        id: '1',
        dealershipId: 'd',
        department: 'service',
        customInstructions: 'Always mention {brand} Roadside.',
        greeting: 'Hi from {dealershipName}',
        disclaimers: 'No same-day promises',
        toneGuidelines: 'Warm',
        version: 2,
        updatedAt: null,
        updatedByTechnicianId: null,
        isCustomized: true,
      },
      { dealershipName: 'Viti', brand: 'Mercedes-Benz' }
    );
    assert.match(block, /Personal tailoring/i);
    assert.match(block, /Mercedes-Benz Roadside/);
    assert.match(block, /No same-day promises/);
  });
});
