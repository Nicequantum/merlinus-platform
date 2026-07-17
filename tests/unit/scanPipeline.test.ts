import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '@/lib/api';
import { GENERIC_ERROR } from '@/lib/errors';
import {
  enrichScannedRepairLinesWithCustomerPayTemplates,
  filterScannedComplaintsForProcessing,
  formatScanApiError,
  generateDynamicCustomerPayNarrative,
  isRetriableScanMessage,
  isStrongGrokExtraction,
  matchCustomerPayTemplateFromScanText,
} from '@/lib/scanPipeline';
import { emptyExtractedData } from '@/utils/diagnosticParser';

describe('scan pipeline errors', () => {
  it('surfaces ApiError messages to technicians', () => {
    const message = formatScanApiError(
      new ApiError('Repair order scan timed out — try again in a moment.', 504)
    );
    assert.equal(message, 'Repair order scan timed out — try again in a moment.');
  });

  it('includes HTTP status when server returns generic error text', () => {
    const message = formatScanApiError(new ApiError(GENERIC_ERROR, 500));
    assert.match(message, /HTTP 500/);
    assert.match(message, /Something went wrong/);
  });

  it('prefers server message over fallback', () => {
    const message = formatScanApiError(
      new ApiError('Photo upload failed: storage quota exceeded', 502),
      'ignored fallback'
    );
    assert.equal(message, 'Photo upload failed: storage quota exceeded');
  });

  it('detects retriable scan messages', () => {
    assert.equal(isRetriableScanMessage('AI service is busy. Wait a moment and try again.'), true);
    assert.equal(isRetriableScanMessage('This photo is not available for processing.'), false);
  });

  it('treats Grok output with complaints as strong enough to skip OCR wait', () => {
    assert.equal(
      isStrongGrokExtraction({
        vehicle: { vin: '', year: '', make: '', model: '', engine: '', mileageIn: '', mileageOut: '' },
        complaints: ['Check engine light on'],
        customerName: 'Jane',
        roNumber: '12345',
      }),
      true
    );
  });

  it('requires OCR fallback when Grok returns no complaints and incomplete header', () => {
    assert.equal(isStrongGrokExtraction(null), false);
    assert.equal(
      isStrongGrokExtraction({
        vehicle: { vin: '', year: '', make: '', model: '', engine: '', mileageIn: '', mileageOut: '' },
        complaints: [],
        customerName: '',
        roNumber: '',
      }),
      false
    );
  });
});

describe('scan pipeline service lines', () => {
  it('retains B-service and menu package lines (no warranty-only drop)', () => {
    const filtered = filterScannedComplaintsForProcessing(
      ['Check engine light on', 'B Service', 'A Service', 'Front brake job customer pay'],
      ['A', 'B', 'C', 'D']
    );
    assert.deepEqual(filtered.complaintLabels, ['A', 'B', 'C', 'D']);
    assert.equal(filtered.complaints.length, 4);
    assert.equal(filtered.complaints[1], 'B Service');
    assert.equal(filtered.complaints[2], 'A Service');
  });

  it('matches restored B Service / A Service / LOF templates from scan text', () => {
    const b = matchCustomerPayTemplateFromScanText('B. B SERVICE');
    assert.equal(b?.templateTitle, 'B Service');
    assert.match(b?.preWrittenStory ?? '', /Service B per Mercedes-Benz/i);

    const a = matchCustomerPayTemplateFromScanText('# C A SERVICE');
    assert.equal(a?.templateTitle, 'A Service');
    assert.match(a?.preWrittenStory ?? '', /Service A per Mercedes-Benz/i);

    const lof = matchCustomerPayTemplateFromScanText('D. Oil change / LOF service');
    assert.equal(lof?.templateTitle, 'Lube, Oil & Filter Service');
  });

  it('matches customer pay templates from scanned line text', () => {
    const match = matchCustomerPayTemplateFromScanText('B. Front brake job — rotors and pads');
    assert.equal(match?.templateTitle, 'Front Brake Job');
    assert.match(match?.preWrittenStory ?? '', /^Performed a complete front brake service/);
  });

  it('does not match ambiguous warranty concerns', () => {
    assert.equal(matchCustomerPayTemplateFromScanText('Customer states vibration at highway speed'), null);
  });

  it('matches expanded customer pay templates from scan text', () => {
    const match = matchCustomerPayTemplateFromScanText('C. Wiper blade replacement — streaking windshield');
    assert.equal(match?.templateTitle, 'Wiper Blade Replacement');
  });

  it('generateDynamicCustomerPayNarrative falls back to base template without Grok', async () => {
    const base =
      'Performed wiper blade replacement service. Removed the worn wiper blade inserts or complete blade assemblies and installed new wiper blades.';
    const narrative = await generateDynamicCustomerPayNarrative({
      templateTitle: 'Wiper Blade Replacement',
      baseTemplate: base,
      customerComplaint: 'Customer states wipers streak',
    });
    assert.equal(narrative, base);
  });

  it('applies pre-written narratives only to matching unscanned lines', async () => {
    const lines = await enrichScannedRepairLinesWithCustomerPayTemplates(
      [
        {
          id: 'line-1',
          lineNumber: 1,
          description: 'A. Check engine light',
          customerConcern: 'Check engine light',
          technicianNotes: '',
          xentryImages: [],
          extractedData: emptyExtractedData(),
        },
        {
          id: 'line-2',
          lineNumber: 2,
          description: 'B. Front brake job',
          customerConcern: 'Front brake job',
          technicianNotes: '',
          xentryImages: [],
          extractedData: emptyExtractedData(),
        },
      ],
      ['Check engine light', 'Front brake job'],
      ['A', 'B']
    );

    assert.equal(lines[0].isCustomerPay, undefined);
    assert.equal(lines[0].warrantyStory, undefined);
    assert.equal(lines[1].isCustomerPay, true);
    assert.match(lines[1].warrantyStory ?? '', /^Performed a complete front brake service/);
  });

  it('does not overwrite an existing warranty story', async () => {
    const existingStory = 'Existing warranty narrative.';
    const lines = await enrichScannedRepairLinesWithCustomerPayTemplates(
      [
        {
          id: 'line-1',
          lineNumber: 1,
          description: 'B. Front brake job',
          customerConcern: 'Front brake job',
          technicianNotes: '',
          xentryImages: [],
          extractedData: emptyExtractedData(),
          warrantyStory: existingStory,
        },
      ],
      ['Front brake job'],
      ['B']
    );

    assert.equal(lines[0].warrantyStory, existingStory);
    assert.equal(lines[0].isCustomerPay, undefined);
  });
});