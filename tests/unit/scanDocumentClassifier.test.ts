import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyScanPageText,
  classifyScanPages,
  combineRepairOrderPages,
  combineVmiPages,
} from '../../src/utils/scanDocumentClassifier';

describe('scan document classifier', () => {
  test('classifies VMI pages separately from repair orders', () => {
    const vmiText = `Vehicle Master Inquiry
Factory Warranty Expiration: 03/15/2028
CPO Warranty: 09/01/2027
Extended ELA Warranty: 12/31/2029
Service History Summary`;
    const roText = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION`;

    assert.equal(classifyScanPageText(vmiText), 'vmi');
    assert.equal(classifyScanPageText(roText), 'repair_order');
  });

  test('combines only RO pages for complaint OCR', () => {
    const combined = `=== PAGE 1 ===
LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION

=== PAGE 2 ===
Vehicle Master Inquiry
Factory Warranty Expiration: 03/15/2028
CPO Warranty: 09/01/2027`;

    const pages = classifyScanPages(combined);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].kind, 'repair_order');
    assert.equal(pages[1].kind, 'vmi');
    assert.match(combineRepairOrderPages(pages), /STATE INSPECTION/);
    assert.doesNotMatch(combineRepairOrderPages(pages), /Vehicle Master Inquiry/);
    assert.match(combineVmiPages(pages), /Factory Warranty/);
  });
});