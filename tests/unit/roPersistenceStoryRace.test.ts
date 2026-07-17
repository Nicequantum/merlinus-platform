import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { preserveClientWarrantyStories } from '../../src/hooks/repairOrders/useROPersistence';
import type { RepairOrder } from '../../src/types';

const baseRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '123',
  vehicle: { vin: 'W1N', year: '2022', make: 'Mercedes-Benz', model: 'GLE', mileageIn: '1000' },
  customer: { name: 'Test' },
  complaints: ['Noise'],
  repairLines: [
    {
      id: 'line-1',
      lineNumber: 1,
      description: 'Diag',
      customerConcern: 'Noise',
      technicianNotes: 'Found issue',
      xentryImages: [],
      warrantyStory: '',
    },
  ],
};

describe('RO persistence story race guards', () => {
  test('preserveClientWarrantyStories keeps in-memory story when server response is empty', () => {
    const client: RepairOrder = {
      ...baseRo,
      repairLines: [{ ...baseRo.repairLines[0], warrantyStory: 'Generated warranty narrative.' }],
    };
    const persisted: RepairOrder = {
      ...baseRo,
      repairLines: [{ ...baseRo.repairLines[0], warrantyStory: '' }],
    };

    const merged = preserveClientWarrantyStories(persisted, client);
    assert.equal(merged.repairLines[0].warrantyStory, 'Generated warranty narrative.');
  });

  test('persistRO uses roRef at execution time', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROPersistence.ts'), 'utf8');
    assert.match(src, /roRef\.current\?\.id === ro\.id \? roRef\.current : ro/);
  });

  test('Save as Template stays visible when a generated story exists', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/LineView.tsx'), 'utf8');
    assert.match(src, /lastGeneratedStoryText && line\.warrantyStory/);
    assert.doesNotMatch(src, /storyEditedSinceGenerate/);
  });

  test('story generation does not auto-score after API returns', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    assert.match(src, /scoreStory/);
    assert.doesNotMatch(src, /void \(async \(\) => \{[\s\S]*api\.scoreStory/);
  });

  test('generate story workflow skips immediate RO save after API', () => {
    const src = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    assert.match(src, /generate-story API already persisted/);
    assert.doesNotMatch(src, /warrantyStory \}\s*:\s*l\)\)\),\s*\n\s*\{ immediate: true \}/);
  });
});