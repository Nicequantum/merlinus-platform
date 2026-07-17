import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { dbToRepairLine, repairLineToDbFields } from '@/lib/roMapper';
import {
  hasSoldMetrics,
  mapSoldMetricsFromDb,
  soldMetricsToDbUpdateFields,
} from '@/lib/repairLineSoldMetrics';

describe('repairLineSoldMetrics', () => {
  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
    process.env.SEARCH_HMAC_KEY =
      process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';
  });

  it('maps sold metrics from database rows', () => {
    const mapped = mapSoldMetricsFromDb({
      soldLaborHours: 2.5,
      soldLaborAmount: 350,
      soldPartsAmount: 120,
      customerApproved: true,
      isAddOn: false,
      soldMetricsUpdatedAt: new Date('2026-06-27T12:00:00.000Z'),
    });

    assert.equal(mapped.soldLaborHours, 2.5);
    assert.equal(mapped.soldLaborAmount, 350);
    assert.equal(mapped.customerApproved, true);
    assert.equal(mapped.isAddOn, false);
    assert.equal(mapped.soldMetricsUpdatedAt, '2026-06-27T12:00:00.000Z');
  });

  it('dbToRepairLine exposes soldMetrics on RepairLine', () => {
    const line = dbToRepairLine({
      id: 'line-1',
      repairOrderId: 'ro-1',
      lineNumber: 1,
      descriptionEncrypted: '',
      customerConcernEncrypted: '',
      technicianNotesEncrypted: '',
      xentryImageUrls: '[]',
      xentryOcrTextsEncrypted: '',
      extractedDataEncrypted: '{}',
      warrantyStoryEncrypted: null,
      storyQualityAuditEncrypted: '',
      isCustomerPay: false,
      soldLaborHours: 1.2,
      soldLaborAmount: 180,
      soldPartsAmount: 95,
      customerApproved: true,
      isAddOn: true,
      soldMetricsUpdatedAt: new Date('2026-06-27T12:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.ok(hasSoldMetrics(line.soldMetrics));
    assert.equal(line.soldMetrics?.soldLaborHours, 1.2);
    assert.equal(line.soldMetrics?.isAddOn, true);
  });

  it('repairLineToDbFields does not overwrite sold metrics on technician saves', () => {
    const fields = repairLineToDbFields({
      id: 'line-1',
      lineNumber: 1,
      description: 'Oil change',
      customerConcern: '',
      technicianNotes: '',
      xentryImages: [],
      warrantyStory: 'Story text',
      isCustomerPay: false,
      soldMetrics: {
        soldLaborHours: 2,
        soldLaborAmount: 200,
        soldPartsAmount: 50,
        customerApproved: true,
        isAddOn: false,
      },
    });

    assert.equal('soldLaborHours' in fields, false);
    assert.equal('soldLaborAmount' in fields, false);
    assert.equal('customerApproved' in fields, false);
    assert.equal('isAddOn' in fields, false);
  });

  it('soldMetricsToDbUpdateFields writes RepairLine columns', () => {
    const fields = soldMetricsToDbUpdateFields({
      soldLaborHours: 3,
      soldLaborAmount: 400,
      soldPartsAmount: 150,
      customerApproved: false,
      isAddOn: true,
    });

    assert.equal(fields.soldLaborHours, 3);
    assert.equal(fields.soldLaborAmount, 400);
    assert.equal(fields.customerApproved, false);
    assert.equal(fields.isAddOn, true);
    assert.ok(fields.soldMetricsUpdatedAt instanceof Date);
  });
});