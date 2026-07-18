import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  dbToRepairLine,
  dbToRepairOrder,
  dbToRepairOrderSummary,
  repairLineToDbFields,
  repairOrderToDbFields,
} from '../../src/lib/roMapper';
import type { RepairLine, RepairOrder, StoryQualityResult } from '../../src/types';

const sampleRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '482910',
  vehicle: {
    vin: 'W1N4N4HB5NJ123456',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    mileageIn: '28450',
    mileageOut: '28458',
  },
  customer: { name: 'John Smith' },
  complaints: ['# A CHECK ENGINE LIGHT ON'],
  xentryOcrTexts: ['RO-level Quick Test OCR block'],
  repairLines: [],
};

const sampleLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON',
  technicianNotes: 'Found P0300. Source voltage 12.4V.',
  xentryImages: [],
  xentryOcrTexts: ['P0300 Random Misfire', 'Cylinder 3 misfire count elevated'],
  extractedData: {
    codes: ['P0300'],
    faultCodes: [{ code: 'P0300', description: 'Random/multiple cylinder misfire detected' }],
    guidedTests: [],
    measurements: [],
    components: [],
    circuits: [],
  },
  warrantyStory: 'Customer presented with check engine light. Verified P0300 and replaced coil.',
};

describe('roMapper sensitive field encryption', () => {
  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
    process.env.SEARCH_HMAC_KEY =
      process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';
  });

  test('repairOrderToDbFields encrypts RO-level OCR text arrays', () => {
    const fields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      xentryOcrTexts: sampleRo.xentryOcrTexts,
      repairLines: [],
    });

    assert.notEqual(fields.xentryOcrTextsEncrypted, JSON.stringify(sampleRo.xentryOcrTexts));
    assert.ok(fields.xentryOcrTextsEncrypted.length > 0);
    assert.equal('roNumber' in fields, false);
    // D1/SQLite: blind-index tokens stored as JSON string (not String[])
    assert.equal(typeof fields.roNumberSearchTokens, 'string');
    assert.ok(fields.roNumberSearchTokens.length > 2);
    const parsedTokens = JSON.parse(fields.roNumberSearchTokens) as unknown;
    assert.ok(Array.isArray(parsedTokens));
    assert.ok((parsedTokens as string[]).length > 0);
  });

  test('repairLineToDbFields encrypts technician notes, OCR texts, and warranty stories', () => {
    const fields = repairLineToDbFields(sampleLine);

    assert.notEqual(fields.technicianNotesEncrypted, sampleLine.technicianNotes);
    assert.notEqual(fields.xentryOcrTextsEncrypted, JSON.stringify(sampleLine.xentryOcrTexts));
    assert.notEqual(fields.warrantyStoryEncrypted, sampleLine.warrantyStory);
    assert.notEqual(fields.extractedDataEncrypted, JSON.stringify(sampleLine.extractedData));
    assert.ok(fields.technicianNotesEncrypted.length > 0);
    assert.ok(fields.xentryOcrTextsEncrypted.length > 0);
    assert.ok(fields.warrantyStoryEncrypted && fields.warrantyStoryEncrypted.length > 0);
    assert.ok(fields.extractedDataEncrypted.length > 0);
    assert.equal('storyQualityAuditEncrypted' in fields, false);
    assert.equal('description' in fields, false);
  });

  test('repairLineToDbFields encrypts persisted story quality audits when provided', () => {
    const audit: StoryQualityResult = {
      score: 82,
      grade: 'strong',
      strengths: ['Clear workflow'],
      improvements: [],
      auditRisks: [],
      technicianDetails: [],
      summary: 'Solid narrative',
      scoredAgainstStory: sampleLine.warrantyStory,
    };
    const fields = repairLineToDbFields({ ...sampleLine, storyQualityAudit: audit });
    assert.ok(fields.storyQualityAuditEncrypted && fields.storyQualityAuditEncrypted.length > 0);
    assert.notEqual(fields.storyQualityAuditEncrypted, JSON.stringify(audit));
  });

  test('db mappers decrypt sensitive fields back to plaintext for API/UI', () => {
    const roFields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      xentryOcrTexts: sampleRo.xentryOcrTexts,
      repairLines: [],
    });
    const lineFields = repairLineToDbFields(sampleLine);

    const mappedRo = dbToRepairOrder({
      id: 'ro-1',
      roNumberEncrypted: roFields.roNumberEncrypted,
      roNumberSearchTokens: roFields.roNumberSearchTokens,
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      serviceAdvisorId: null,
      serviceAdvisorNameEncrypted: '',
      advisorMatchConfidence: null,
      advisorIdentifiedAt: null,
      vinEncrypted: roFields.vinEncrypted,
      year: roFields.year,
      make: roFields.make,
      model: roFields.model,
      engine: roFields.engine,
      mileageIn: roFields.mileageIn,
      mileageOut: roFields.mileageOut,
      customerNameEncrypted: roFields.customerNameEncrypted,
      complaintsEncrypted: roFields.complaintsEncrypted,
      xentryImageUrls: roFields.xentryImageUrls,
      xentryOcrTextsEncrypted: roFields.xentryOcrTextsEncrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [
        {
          id: sampleLine.id,
          repairOrderId: 'ro-1',
          lineNumber: sampleLine.lineNumber,
          descriptionEncrypted: lineFields.descriptionEncrypted,
          customerConcernEncrypted: lineFields.customerConcernEncrypted,
          technicianNotesEncrypted: lineFields.technicianNotesEncrypted,
          xentryImageUrls: lineFields.xentryImageUrls,
          xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
          extractedDataEncrypted: lineFields.extractedDataEncrypted,
          warrantyStoryEncrypted: lineFields.warrantyStoryEncrypted,
          storyQualityAuditEncrypted: '',
          isCustomerPay: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      serviceAdvisor: null,
    });

    const mappedLine = mappedRo.repairLines[0];
    assert.deepEqual(mappedRo.xentryOcrTexts, sampleRo.xentryOcrTexts);
    assert.equal(mappedLine.technicianNotes, sampleLine.technicianNotes);
    assert.deepEqual(mappedLine.xentryOcrTexts, sampleLine.xentryOcrTexts);
    assert.equal(mappedLine.warrantyStory, sampleLine.warrantyStory);
    assert.deepEqual(mappedLine.extractedData?.codes, sampleLine.extractedData?.codes);
    assert.equal(mappedLine.storyQualityAudit, null);
  });

  test('dbToRepairOrder reads roNumber from encrypted column', () => {
    const roFields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      repairLines: [],
    });

    const mapped = dbToRepairOrder({
      id: 'ro-encrypted-only',
      roNumberEncrypted: roFields.roNumberEncrypted,
      roNumberSearchTokens: roFields.roNumberSearchTokens,
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      serviceAdvisorId: null,
      serviceAdvisorNameEncrypted: '',
      advisorMatchConfidence: null,
      advisorIdentifiedAt: null,
      vinEncrypted: roFields.vinEncrypted,
      year: roFields.year,
      make: roFields.make,
      model: roFields.model,
      engine: roFields.engine,
      mileageIn: roFields.mileageIn,
      mileageOut: roFields.mileageOut,
      customerNameEncrypted: roFields.customerNameEncrypted,
      complaintsEncrypted: roFields.complaintsEncrypted,
      xentryImageUrls: roFields.xentryImageUrls,
      xentryOcrTextsEncrypted: roFields.xentryOcrTextsEncrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [],
      serviceAdvisor: null,
    });

    assert.equal(mapped.roNumber, sampleRo.roNumber);
  });

  test('dbToRepairLine decrypts persisted story quality audits', () => {
    const audit: StoryQualityResult = {
      score: 91,
      grade: 'excellent',
      strengths: [],
      improvements: [],
      auditRisks: [],
      technicianDetails: [],
      summary: 'Ready',
      scoredAgainstStory: sampleLine.warrantyStory,
    };
    const lineFields = repairLineToDbFields({ ...sampleLine, storyQualityAudit: audit });
    const mapped = dbToRepairLine({
      id: sampleLine.id,
      repairOrderId: 'ro-1',
      lineNumber: sampleLine.lineNumber,
      descriptionEncrypted: lineFields.descriptionEncrypted,
      customerConcernEncrypted: lineFields.customerConcernEncrypted,
      technicianNotesEncrypted: lineFields.technicianNotesEncrypted,
      xentryImageUrls: lineFields.xentryImageUrls,
      xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
      extractedDataEncrypted: lineFields.extractedDataEncrypted,
      warrantyStoryEncrypted: lineFields.warrantyStoryEncrypted,
      storyQualityAuditEncrypted: lineFields.storyQualityAuditEncrypted ?? '',
      isCustomerPay: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(mapped.storyQualityAudit?.score, 91);
    assert.equal(mapped.storyQualityAudit?.scoredAgainstStory, sampleLine.warrantyStory);
  });

  test('dbToRepairOrder reads legacy plaintext stored in encrypted PII columns', () => {
    const legacyRoNumber = '482910';
    const legacyVin = 'W1N4N4HB5NJ123456';
    const legacyCustomer = 'Jane Dealer';
    const legacyConcern = 'CHECK ENGINE LIGHT ON AT STARTUP';
    const legacyDescription = 'Engine diagnosis';
    const legacyNotes = 'Found P0300 on cylinder 3.';

    const mapped = dbToRepairOrder({
      id: 'ro-legacy',
      roNumberEncrypted: legacyRoNumber,
      roNumberSearchTokens: '[]',
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      serviceAdvisorId: null,
      serviceAdvisorNameEncrypted: 'Advisor Smith',
      advisorMatchConfidence: null,
      advisorIdentifiedAt: null,
      vinEncrypted: legacyVin,
      year: sampleRo.vehicle.year,
      make: sampleRo.vehicle.make,
      model: sampleRo.vehicle.model,
      engine: '',
      mileageIn: sampleRo.vehicle.mileageIn,
      mileageOut: sampleRo.vehicle.mileageOut,
      customerNameEncrypted: legacyCustomer,
      complaintsEncrypted: JSON.stringify(sampleRo.complaints),
      xentryImageUrls: '[]',
      xentryOcrTextsEncrypted: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [
        {
          id: sampleLine.id,
          repairOrderId: 'ro-legacy',
          lineNumber: sampleLine.lineNumber,
          descriptionEncrypted: legacyDescription,
          customerConcernEncrypted: legacyConcern,
          technicianNotesEncrypted: legacyNotes,
          xentryImageUrls: '[]',
          xentryOcrTextsEncrypted: '',
          extractedDataEncrypted: JSON.stringify(sampleLine.extractedData),
          warrantyStoryEncrypted: sampleLine.warrantyStory ?? null,
          storyQualityAuditEncrypted: '',
          isCustomerPay: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      serviceAdvisor: null,
    });

    assert.equal(mapped.roNumber, legacyRoNumber);
    assert.equal(mapped.vehicle.vin, legacyVin);
    assert.equal(mapped.customer.name, legacyCustomer);
    assert.equal(mapped.serviceAdvisorName, 'Advisor Smith');
    assert.equal(mapped.repairLines[0]?.description, legacyDescription);
    assert.equal(mapped.repairLines[0]?.customerConcern, legacyConcern);
    assert.equal(mapped.repairLines[0]?.technicianNotes, legacyNotes);
    assert.equal(mapped.piiDecryptWarnings, undefined);
  });

  test('dbToRepairOrder tolerates unreadable encrypted PII fields', () => {
    const roFields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      repairLines: [],
    });
    const lineFields = repairLineToDbFields(sampleLine);
    const wrongKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreignVin = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: { ...sampleRo.vehicle, vin: 'WDDZF8EB5MA999999' },
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      repairLines: [],
    }).vinEncrypted;
    process.env.DATA_ENCRYPTION_KEY = wrongKey;

    const mapped = dbToRepairOrder({
      id: 'ro-corrupt',
      roNumberEncrypted: roFields.roNumberEncrypted,
      roNumberSearchTokens: roFields.roNumberSearchTokens,
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      serviceAdvisorId: null,
      serviceAdvisorNameEncrypted: foreignVin,
      advisorMatchConfidence: null,
      advisorIdentifiedAt: null,
      vinEncrypted: foreignVin,
      year: roFields.year,
      make: roFields.make,
      model: roFields.model,
      engine: roFields.engine,
      mileageIn: roFields.mileageIn,
      mileageOut: roFields.mileageOut,
      customerNameEncrypted: foreignVin,
      complaintsEncrypted: roFields.complaintsEncrypted,
      xentryImageUrls: roFields.xentryImageUrls,
      xentryOcrTextsEncrypted: roFields.xentryOcrTextsEncrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [
        {
          id: sampleLine.id,
          repairOrderId: 'ro-corrupt',
          lineNumber: sampleLine.lineNumber,
          descriptionEncrypted: lineFields.descriptionEncrypted,
          customerConcernEncrypted: foreignVin,
          technicianNotesEncrypted: lineFields.technicianNotesEncrypted,
          xentryImageUrls: lineFields.xentryImageUrls,
          xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
          extractedDataEncrypted: foreignVin,
          warrantyStoryEncrypted: lineFields.warrantyStoryEncrypted,
          storyQualityAuditEncrypted: '',
          isCustomerPay: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      serviceAdvisor: null,
    });

    assert.equal(mapped.roNumber, sampleRo.roNumber);
    assert.equal(mapped.vehicle.vin, '');
    assert.equal(mapped.customer.name, '');
    assert.equal(mapped.repairLines[0]?.customerConcern, '');
    assert.deepEqual(mapped.repairLines[0]?.extractedData?.codes, []);
    assert.ok(mapped.piiDecryptWarnings?.length);
    assert.ok(mapped.piiDecryptWarnings?.includes('VIN'));
    assert.ok(mapped.piiDecryptWarnings?.includes('Customer name'));
    assert.ok(mapped.piiDecryptWarnings?.some((w) => w.includes('customer concern')));
  });

  test('dbToRepairLine tolerates unreadable technician notes and warranty story', () => {
    const lineFields = repairLineToDbFields(sampleLine);
    const wrongKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreignNotes = repairLineToDbFields({
      ...sampleLine,
      technicianNotes: 'Corrupt ciphertext notes',
      warrantyStory: 'Corrupt ciphertext story',
    });
    process.env.DATA_ENCRYPTION_KEY = wrongKey;

    const mapped = dbToRepairLine({
      id: sampleLine.id,
      repairOrderId: 'ro-1',
      lineNumber: sampleLine.lineNumber,
      descriptionEncrypted: lineFields.descriptionEncrypted,
      customerConcernEncrypted: lineFields.customerConcernEncrypted,
      technicianNotesEncrypted: foreignNotes.technicianNotesEncrypted,
      xentryImageUrls: lineFields.xentryImageUrls,
      xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
      extractedDataEncrypted: lineFields.extractedDataEncrypted,
      warrantyStoryEncrypted: foreignNotes.warrantyStoryEncrypted,
      storyQualityAuditEncrypted: '',
      isCustomerPay: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(mapped.technicianNotes, '');
    assert.equal(mapped.warrantyStory, undefined);
    assert.equal(mapped.storyCertification, null);
  });

  test('dbToRepairOrderSummary avoids decrypting line PII and story text', () => {
    const roFields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      repairLines: [],
    });
    const lineFields = repairLineToDbFields(sampleLine);
    const summary = dbToRepairOrderSummary({
      id: 'ro-1',
      roNumberEncrypted: roFields.roNumberEncrypted,
      roNumberSearchTokens: roFields.roNumberSearchTokens,
      vinEncrypted: roFields.vinEncrypted,
      year: sampleRo.vehicle.year,
      make: sampleRo.vehicle.make,
      model: sampleRo.vehicle.model,
      engine: sampleRo.vehicle.engine ?? '',
      mileageIn: sampleRo.vehicle.mileageIn,
      mileageOut: sampleRo.vehicle.mileageOut,
      customerNameEncrypted: roFields.customerNameEncrypted,
      complaintsEncrypted: roFields.complaintsEncrypted,
      xentryImageUrls: '[]',
      xentryOcrTextsEncrypted: '',
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [
        {
          id: sampleLine.id,
          repairOrderId: 'ro-1',
          lineNumber: sampleLine.lineNumber,
          descriptionEncrypted: lineFields.descriptionEncrypted,
          customerConcernEncrypted: lineFields.customerConcernEncrypted,
          technicianNotesEncrypted: lineFields.technicianNotesEncrypted,
          xentryImageUrls: lineFields.xentryImageUrls,
          xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
          extractedDataEncrypted: lineFields.extractedDataEncrypted,
          warrantyStoryEncrypted: lineFields.warrantyStoryEncrypted,
          isCustomerPay: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      technician: { name: 'Tech One' },
    });

    assert.equal(summary.roNumber, sampleRo.roNumber);
    assert.equal(summary.firstComplaintPreview, sampleRo.complaints[0]);
    assert.equal(summary.technicianName, 'Tech One');
    assert.equal(summary.repairLines.length, 1);
    assert.equal(summary.repairLines[0]?.hasWarrantyStory, true);
    assert.equal('customerConcern' in (summary.repairLines[0] ?? {}), false);
    assert.equal('warrantyStory' in (summary.repairLines[0] ?? {}), false);
    assert.equal('vin' in summary.vehicle, false);
  });
});