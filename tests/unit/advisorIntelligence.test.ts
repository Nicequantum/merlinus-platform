import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  complaintLineLabel,
  fingerprintAdvisorName,
  inferVehicleFamily,
  isPlausibleAdvisorName,
  normalizeAdvisorDisplayName,
} from '../../src/lib/advisorIntelligence/nameUtils';
import {
  extractServiceAdvisorFromText,
  parseStructuredROText,
} from '../../src/utils/roExtractor';

describe('advisor name utilities', () => {
  test('fingerprints normalize punctuation and casing', () => {
    assert.equal(fingerprintAdvisorName('Maria L.'), fingerprintAdvisorName('maria l'));
    assert.equal(normalizeAdvisorDisplayName('MARIA L SMITH'), 'Maria L Smith');
  });

  test('rejects noise labels and implausible names', () => {
    assert.equal(isPlausibleAdvisorName('Service Advisor'), false);
    assert.equal(isPlausibleAdvisorName('AB'), false);
    assert.equal(isPlausibleAdvisorName('Jordan Reyes'), true);
  });

  test('maps complaint indices to letter labels', () => {
    assert.equal(complaintLineLabel(0), 'A');
    assert.equal(complaintLineLabel(2), 'C');
  });

  test('infers Mercedes vehicle families', () => {
    assert.equal(inferVehicleFamily('Mercedes-Benz', 'GLE 350'), 'GLE');
    assert.equal(inferVehicleFamily('Mercedes-Benz', 'AMG GT 53'), 'AMG');
    assert.equal(inferVehicleFamily('Maybach', 'S 580'), 'Maybach');
  });
});

describe('service advisor extraction', () => {
  test('parses structured Grok output line', () => {
    const text = `RO Number: 482910
Customer Name: JOHN SMITH
Service Advisor Name: Maria Lopez
Year: 2022
Make: Mercedes-Benz
Model: GLE 350
VIN: W1N4N4HB5NJ123456
Mileage IN: 28450
Customer Complaints:
A. CHECK ENGINE LIGHT ON`;

    const parsed = parseStructuredROText(text);
    assert.equal(parsed.serviceAdvisorName, 'Maria Lopez');
  });

  test('extracts advisor from raw RO header labels', () => {
    const text = `REPAIR ORDER 482910
Service Advisor: JORDAN REYES
Customer: JOHN SMITH`;

    assert.equal(extractServiceAdvisorFromText(text), 'JORDAN REYES');
  });
});