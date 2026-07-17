import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatAdvisorContextForPrompt,
  type AdvisorPromptContext,
} from '../../src/lib/advisorIntelligence/buildPromptContext';
import { buildWarrantyStoryUserMessage } from '../../src/prompts/warrantyStory';
import type { RepairLine, RepairOrder } from '../../src/types';

const sampleContext: AdvisorPromptContext = {
  serviceAdvisorId: 'adv-1',
  displayName: 'Maria Lopez',
  observationCount: 12,
  profileData: {
    formatting: {
      usesLetterLabels: true,
      labelStyle: 'space',
      typicallyAllCaps: true,
      avgComplaintsPerRo: 2.5,
      avgComplaintLength: 42,
    },
    abbreviations: {},
    commonPhrases: [{ text: 'CHECK ENGINE LIGHT ON', count: 4 }],
    vehicleAffinities: { GLE: 0.6, AMG: 0.2 },
    complaintCategories: {},
    extractionHints: [],
  },
  sampleComplaints: ['CHECK ENGINE LIGHT ON', 'NOISE FROM FRONT SUSPENSION'],
};

const baseRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '482910',
  vehicle: {
    vin: 'W1N4N4HB5NJ123456',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    mileageIn: '28450',
    mileageOut: '',
  },
  customer: { name: 'John Smith' },
  complaints: ['CHECK ENGINE LIGHT ON'],
  repairLines: [],
};

const baseLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON',
  technicianNotes: 'Found P0300',
  xentryImages: [],
};

describe('advisor prompt context', () => {
  test('formats advisor profile with style guidance and guardrails', () => {
    const formatted = formatAdvisorContextForPrompt(sampleContext);
    assert.match(formatted, /Maria Lopez/);
    assert.match(formatted, /ALL CAPS/);
    assert.match(formatted, /CHECK ENGINE LIGHT ON/);
    assert.match(formatted, /GLE \(60%\)/);
    assert.match(formatted, /Customer Complaint phrasing only/);
    assert.match(formatted, /Never transplant example complaints/);
  });

  test('fast story prompt omits advisor context for latency', () => {
    const message = buildWarrantyStoryUserMessage(baseRo, baseLine);
    assert.doesNotMatch(message, /Advisor opening style only/i);
    assert.doesNotMatch(message, /Maria Lopez/);
  });
});