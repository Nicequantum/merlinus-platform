import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  extractComplaints,
  extractLetterLabeledComplaints,
  extractLetterLabeledComplaintsWithLabels,
  extractServiceAdvisorFromText,
  isAcceptableRoLineText,
  isPlausibleComplaintText,
  mergeMultiPassOcrExtractions,
  mergeROExtractions,
  mergeScanSources,
  normalizeComplaintForDisplay,
  parseStructuredROText,
  recoverComplaintsWithLabelsFromText,
  sanitizeComplaints,
} from '../../src/utils/roExtractor';

const REAL_RO_SNIPPET = `RO Number: 482910
Customer Name: JOHN SMITH
Year: 2022
Make: Mercedes-Benz
Model: GLE 350
VIN: W1N4N4HB5NJ123456
Mileage IN: 28450
LINE OPCODE TECH TYPE HOURS
A RHODE ISLAND STATE INSPECTION
RISI RHODE ISLAND STATE INSPECTION
619 CDEF
130132 PASSED`;

const MERGED_HEADER_LINE = `LINE OPCODE TECH TYPE HOURS A RHODE ISLAND STATE INSPECTION`;

const COLLAPSED_OCR_LINE =
  'LINE OPCODE TECH TYPE HOURS A RHODE ISLAND STATE INSPECTION RISI RHODE ISLAND STATE INSPECTION 619 CDEF 130132 PASSED';

const GROK_OUTPUT_MISSING_A = `RO Number: 482910
Customer Name: JOHN SMITH
Year: 2022
Make: Mercedes-Benz
Model: GLE 350
VIN: W1N4N4HB5NJ123456
Mileage IN: 28450
Customer Complaints:
B. RISI RHODE ISLAND STATE INSPECTION
C. 619 CDEF`;

describe('RO complaint extraction', () => {
  test('extracts Line A from minimal real-world RO format', () => {
    const complaints = extractLetterLabeledComplaints(REAL_RO_SNIPPET);
    assert.equal(complaints.length, 1);
    assert.equal(complaints[0], 'RHODE ISLAND STATE INSPECTION');
  });

  test('extracts Line A when merged onto header row', () => {
    const complaints = extractLetterLabeledComplaints(MERGED_HEADER_LINE);
    assert.equal(complaints.length, 1);
    assert.equal(complaints[0], 'RHODE ISLAND STATE INSPECTION');
  });

  test('extracts ALL CAPS complaints without lowercase letters', () => {
    const complaints = extractComplaints('LINE OPCODE TECH TYPE HOURS\nA CHECK ENGINE LIGHT ON');
    assert.ok(complaints.includes('CHECK ENGINE LIGHT ON'));
  });

  test('parseStructuredROText recovers Line A when Grok skips it but OCR text is present', () => {
    const fullText = `${GROK_OUTPUT_MISSING_A}\n${REAL_RO_SNIPPET}`;
    const parsed = parseStructuredROText(fullText);
    assert.ok(parsed.complaints.length >= 1);
    assert.equal(parsed.complaints[0], 'RHODE ISLAND STATE INSPECTION');
  });

  test('parseStructuredROText parses Grok A. format with period', () => {
    const grokText = `Customer Complaints:
A. RHODE ISLAND STATE INSPECTION
B. CHECK ENGINE LIGHT ON`;
    const parsed = parseStructuredROText(grokText);
    assert.deepEqual(parsed.complaints, ['RHODE ISLAND STATE INSPECTION', 'CHECK ENGINE LIGHT ON']);
  });

  test('does not treat unlabeled RISI detail lines as separate complaints', () => {
    const complaints = extractLetterLabeledComplaints(REAL_RO_SNIPPET);
    assert.ok(!complaints.some((c) => c.startsWith('RISI')));
    assert.ok(!complaints.some((c) => c.includes('CDEF')));
  });

  test('extracts multiple letter-labeled complaints in order', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
A RHODE ISLAND STATE INSPECTION
B CHECK ENGINE LIGHT ON
C NOISE FROM REAR`;
    const complaints = extractLetterLabeledComplaints(text);
    assert.deepEqual(complaints, [
      'RHODE ISLAND STATE INSPECTION',
      'CHECK ENGINE LIGHT ON',
      'NOISE FROM REAR',
    ]);
  });

  test('trims RISI/CDEF/PASSED continuations from collapsed OCR line', () => {
    const complaints = extractLetterLabeledComplaints(COLLAPSED_OCR_LINE);
    assert.equal(complaints.length, 1);
    assert.equal(complaints[0], 'RHODE ISLAND STATE INSPECTION');
  });

  test('grok-only mislabeled RISI on B recovers Line A inspection text', () => {
    const parsed = parseStructuredROText(GROK_OUTPUT_MISSING_A);
    assert.deepEqual(parsed.complaints, ['RHODE ISLAND STATE INSPECTION']);
  });

  test('mergeROExtractions recovers Line A from OCR when Grok skips it', () => {
    const grokParsed = parseStructuredROText(GROK_OUTPUT_MISSING_A);
    const ocrParsed = parseStructuredROText(COLLAPSED_OCR_LINE);
    const merged = mergeROExtractions(grokParsed, ocrParsed, COLLAPSED_OCR_LINE);
    assert.equal(merged.complaints[0], 'RHODE ISLAND STATE INSPECTION');
    assert.ok(merged.complaints.length >= 1);
  });

  test('extracts hashtag-prefixed complaints (# A, # B, # C)', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A RHODE ISLAND STATE INSPECTION
# B CHECK ENGINE LIGHT ON
# C NOISE FROM REAR`;
    const complaints = extractLetterLabeledComplaints(text);
    assert.deepEqual(complaints, [
      'RHODE ISLAND STATE INSPECTION',
      'CHECK ENGINE LIGHT ON',
      'NOISE FROM REAR',
    ]);
  });

  test('preserves non-sequential complaint letters (A, B, C, E, F — no D)', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A RHODE ISLAND STATE INSPECTION
# B CHECK ENGINE LIGHT ON
# C NOISE FROM REAR
# E VIBRATION AT HIGHWAY SPEED
# F WIND NOISE FROM SUNROOF`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C', 'E', 'F']
    );
    const recovered = recoverComplaintsWithLabelsFromText(text);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'E', 'F']);
    assert.equal(recovered.complaints.length, 5);
  });

  test('extracts Line A from merged hashtag header row', () => {
    const text = 'LINE OPCODE TECH TYPE HOURS # A RHODE ISLAND STATE INSPECTION # B CHECK ENGINE LIGHT ON';
    const complaints = extractLetterLabeledComplaints(text);
    assert.deepEqual(complaints, ['RHODE ISLAND STATE INSPECTION', 'CHECK ENGINE LIGHT ON']);
  });

  test('does not split RHODE ISLAND STATE INSPECTION into false E I L N letters', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A RHODE ISLAND STATE INSPECTION
# B CHECK ENGINE LIGHT ON
# C NOISE FROM REAR`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C']
    );
    assert.equal(labeled[0].text, 'RHODE ISLAND STATE INSPECTION');
    assert.ok(!labeled.some((item) => ['E', 'I', 'L', 'N'].includes(item.letter)));
  });

  test('extracts A-F from vertical hashtag column with text below each label', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A
RHODE ISLAND STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# C
NOISE FROM REAR SUSPENSION
# D
BRAKE PULSATION AT STOP
# E
VIBRATION AT HIGHWAY SPEED
# F
SUNROOF WIND NOISE`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C', 'D', 'E', 'F']
    );
    assert.equal(labeled[0].text, 'RHODE ISLAND STATE INSPECTION');
    assert.equal(labeled[5].text, 'SUNROOF WIND NOISE');
  });

  test('extracts vertical column when label and text share the same line', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A RHODE ISLAND STATE INSPECTION
# B CHECK ENGINE LIGHT ON
# C BRAKE NOISE FROM FRONT`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C']
    );
    assert.equal(labeled[1].text, 'CHECK ENGINE LIGHT ON');
  });

  test('recovers A-F across two pages in vertical column and rejects Grok hallucinated fragments', () => {
    const ocrText = `=== PAGE 1 ===
LINE OPCODE TECH TYPE HOURS
# A
RHODE ISLAND STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# C
NOISE FROM REAR

=== PAGE 2 ===
# D
BRAKE PULSATION
# E
VIBRATION AT HIGHWAY SPEED
# F
SUNROOF WIND NOISE`;

    const grokGarbage = `Customer Complaints:
A. RHODE ISLAND STATE INSPECTION
E. ISLAND STATE
I. STATE INSPECTION
L. INSPECTION
N. SPECTION`;

    const recovered = recoverComplaintsWithLabelsFromText(`${grokGarbage}\n${ocrText}`);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.equal(recovered.complaints.length, 6);
    assert.ok(!recovered.complaints.some((c) => /^(ISLAND|STATE|INSPECTION|SPECTION)$/i.test(c)));
  });

  test('parseStructuredROText preserves E/F labels from hashtag OCR', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A STATE INSPECTION
# B CHECK ENGINE LIGHT
# C BRAKE NOISE
# E VIBRATION
# F SUNROOF WIND NOISE`;
    const parsed = parseStructuredROText(text);
    assert.deepEqual(parsed.complaintLabels, ['A', 'B', 'C', 'E', 'F']);
    assert.equal(parsed.complaints.length, 5);
  });

  test('rejects VIN fragments and OCR garbage misread as complaints', () => {
    assert.equal(isPlausibleComplaintText('_LI23P5491318'), false);
    assert.equal(isPlausibleComplaintText('SHEETE'), false);
    assert.equal(isPlausibleComplaintText('=EA,-MO'), false);
    assert.equal(isPlausibleComplaintText('Thai ENIIA Ts Rees'), false); // short gibberish tokens
    assert.equal(isPlausibleComplaintText('RHODE ISLAND STATE INSPECTION'), true);
  });

  test('keeps B Service / A Service menu packages as RO line items', () => {
    assert.equal(isAcceptableRoLineText('B Service'), true);
    assert.equal(isAcceptableRoLineText('A Service'), true);
    assert.equal(isAcceptableRoLineText('C Service'), true);
    assert.equal(isAcceptableRoLineText('B-Service'), true);
    assert.equal(isAcceptableRoLineText('B SVC'), true);
    assert.equal(isAcceptableRoLineText('Oil Change'), true);
    assert.equal(isAcceptableRoLineText('Service Package'), true);
    // Still reject pure OCR garbage
    assert.equal(isAcceptableRoLineText('_LI23P5491318'), false);
    assert.equal(isAcceptableRoLineText('619 CDEF'), false);

    const sanitized = sanitizeComplaints([
      'Check engine light on',
      'B Service',
      'A Service',
      '_LI23P5491318',
    ]);
    assert.ok(sanitized.includes('Check engine light on'));
    assert.ok(sanitized.includes('B Service'));
    assert.ok(sanitized.includes('A Service'));
    assert.ok(!sanitized.some((c) => c.includes('_LI')));
  });

  test('extracts lettered B Service and A Service lines from RO OCR text', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A
CHECK ENGINE LIGHT ON
# B
B SERVICE
# C
A SERVICE
# D
OIL CHANGE`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C', 'D']
    );
    assert.match(labeled[0].text, /CHECK ENGINE/i);
    assert.match(labeled[1].text, /B\s*SERVICE/i);
    assert.match(labeled[2].text, /A\s*SERVICE/i);
    assert.match(labeled[3].text, /OIL\s*CHANGE/i);

    const recovered = recoverComplaintsWithLabelsFromText(text);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D']);
    assert.equal(recovered.complaints.length, 4);
    assert.ok(recovered.complaints.some((c) => /B\s*SERVICE/i.test(c)));
    assert.ok(recovered.complaints.some((c) => /A\s*SERVICE/i.test(c)));
  });

  test('pairs stacked label column with complaint text skipping form junk lines', () => {
    const text = `LINE OPCODE TECH TYPE HOURS
# A
# B
# C
# D
# E
# F
_LI23P5491318
SHEETE
RHODE ISLAND STATE INSPECTION
CHECK ENGINE LIGHT ON
NOISE FROM REAR SUSPENSION
BRAKE PULSATION AT STOP
VIBRATION AT HIGHWAY SPEED
SUNROOF WIND NOISE`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C', 'D', 'E', 'F']
    );
    assert.equal(labeled[0].text, 'RHODE ISLAND STATE INSPECTION');
    assert.equal(labeled[5].text, 'SUNROOF WIND NOISE');
  });

  test('mergeROExtractions uses Grok vision text when OCR pairs labels with junk', () => {
    const ocrText = `LINE OPCODE TECH TYPE HOURS
# A
# B
# C
# D
# E
# F
_LI23P5491318
SHEETE
=EA,-MO`;

    const grokExtracted = parseStructuredROText(`Customer Complaints:
A. RHODE ISLAND STATE INSPECTION
B. CHECK ENGINE LIGHT ON
C. NOISE FROM REAR SUSPENSION
D. BRAKE PULSATION AT STOP
E. VIBRATION AT HIGHWAY SPEED
F. SUNROOF WIND NOISE`);

    const merged = mergeROExtractions(grokExtracted, parseStructuredROText(ocrText), ocrText);
    assert.deepEqual(merged.complaintLabels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.equal(merged.complaints[0], 'RHODE ISLAND STATE INSPECTION');
    assert.equal(merged.complaints[5], 'SUNROOF WIND NOISE');
    assert.ok(!merged.complaints.some((c) => c.includes('_LI23')));
  });

  test('normalizeComplaintForDisplay strips customer states boilerplate and ellipsis', () => {
    const cleaned = normalizeComplaintForDisplay(
      'customer states... customer states that... CHECK ENGINE LIGHT ON'
    );
    assert.equal(cleaned, 'CHECK ENGINE LIGHT ON');
  });

  test('normalizeComplaintForDisplay fixes mixed case OCR within one complaint', () => {
    const cleaned = normalizeComplaintForDisplay('RHODE island STATE INSPECTION');
    assert.equal(cleaned, 'RHODE ISLAND STATE INSPECTION');
  });

  test('extracts page 2 complaints after customer states boilerplate', () => {
    const ocrText = `=== PAGE 1 ===
LINE OPCODE TECH TYPE HOURS
# A
customer states... RHODE ISLAND STATE INSPECTION
# B
CHECK ENGINE LIGHT ON

=== PAGE 2 ===
# C
customer states that NOISE FROM REAR SUSPENSION
# D
BRAKE PULSATION AT STOP`;

    const recovered = recoverComplaintsWithLabelsFromText(ocrText);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D']);
    assert.equal(recovered.complaints[0], 'RHODE ISLAND STATE INSPECTION');
    assert.equal(recovered.complaints[2], 'NOISE FROM REAR SUSPENSION');
    assert.equal(recovered.complaints[3], 'BRAKE PULSATION AT STOP');
  });

  test('mergeROExtractions prefers cleaner Grok text over noisy OCR', () => {
    const ocrText = `LINE OPCODE TECH TYPE HOURS
# A
customer states... cHeCk EnGiNe LiGhT oN
# B
RHODE island STATE INSPECTION`;

    const grokExtracted = parseStructuredROText(`Customer Complaints:
A. CHECK ENGINE LIGHT ON
B. RHODE ISLAND STATE INSPECTION`);

    const merged = mergeROExtractions(grokExtracted, parseStructuredROText(ocrText), ocrText);
    assert.equal(merged.complaints[0], 'CHECK ENGINE LIGHT ON');
    assert.equal(merged.complaints[1], 'RHODE ISLAND STATE INSPECTION');
  });

  test('extracts complaints after DESCRIPTION / INSTRUCTIONS header', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
RHODE ISLAND STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# C
QUALITY CONTROL`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C']
    );
    assert.equal(labeled[2].text, 'QUALITY CONTROL');
  });

  test('page 2 leftover text continues prior complaint before next hashtag label', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# C
NOISE FROM REAR WHINE

=== PAGE 2 ===
WHEN TURNING LEFT
# D
BRAKE PULSATION
# E
QUALITY CONTROL
# F
SUNROOF WIND NOISE`;

    const recovered = recoverComplaintsWithLabelsFromText(text);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.ok(recovered.complaints[2].includes('NOISE FROM REAR WHINE'));
    assert.ok(recovered.complaints[2].includes('WHEN TURNING LEFT'));
    assert.equal(recovered.complaints[4], 'QUALITY CONTROL');
    assert.equal(recovered.complaints[5], 'SUNROOF WIND NOISE');
  });

  test('mergeROExtractions keeps every hashtag label even when text is short', () => {
    const ocrText = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
RHODE ISLAND STATE INSPECTION
# B
QC
# C
CHECK ENGINE LIGHT ON`;

    const grokExtracted = parseStructuredROText(`Customer Complaints:
A. RHODE ISLAND STATE INSPECTION
B. QUALITY CONTROL
C. CHECK ENGINE LIGHT ON`);

    const merged = mergeROExtractions(grokExtracted, parseStructuredROText(ocrText), ocrText);
    assert.deepEqual(merged.complaintLabels, ['A', 'B', 'C']);
    assert.ok(['QC', 'QUALITY CONTROL'].includes(merged.complaints[1]));
  });

  test('extracts letters beyond F (G, H) when present on RO', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# G
SUNROOF WIND NOISE
# H
VIBRATION AT SPEED`;

    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'G', 'H']
    );
    assert.equal(labeled[2].text, 'SUNROOF WIND NOISE');
  });

  test('finds all stacked slot labels even when only one hashtag OCR line is obvious', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
# B
# C
# D
# E
# F
RHODE ISLAND STATE INSPECTION
CHECK ENGINE LIGHT ON
NOISE FROM REAR SUSPENSION
BRAKE PULSATION AT STOP
QUALITY CONTROL
SUNROOF WIND NOISE`;

    const recovered = recoverComplaintsWithLabelsFromText(text);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.equal(recovered.complaints[0], 'RHODE ISLAND STATE INSPECTION');
    assert.equal(recovered.complaints[1], 'CHECK ENGINE LIGHT ON');
    assert.equal(recovered.complaints[5], 'SUNROOF WIND NOISE');
  });

  test('mergeROExtractions unions Grok labels when OCR only pairs one line', () => {
    const ocrText = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# B
CHECK ENGINE LIGHT ON`;

    const grokExtracted = parseStructuredROText(`Customer Complaints:
A. RHODE ISLAND STATE INSPECTION
B. CHECK ENGINE LIGHT ON
C. NOISE FROM REAR
D. BRAKE PULSATION
E. QUALITY CONTROL
F. SUNROOF WIND NOISE`);

    const merged = mergeROExtractions(grokExtracted, parseStructuredROText(ocrText), ocrText);
    assert.deepEqual(merged.complaintLabels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.equal(merged.complaints[0], 'RHODE ISLAND STATE INSPECTION');
    assert.equal(merged.complaints[1], 'CHECK ENGINE LIGHT ON');
    assert.equal(merged.complaints[5], 'SUNROOF WIND NOISE');
  });

  test('extracts Line A jammed directly on DESCRIPTION / INSTRUCTIONS header', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS # A Drop-off loaner car or van supplied
# B
CHECK ENGINE LIGHT ON`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.equal(labeled[0].letter, 'A');
    assert.equal(labeled[0].text, 'Drop-off loaner car or van supplied');
    assert.equal(labeled[1].text, 'CHECK ENGINE LIGHT ON');
  });

  test('extracts Line A when complaint text is flush on header without hashtag', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS Drop-off loaner car or van supplied
# B
CHECK ENGINE LIGHT ON`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.equal(labeled[0].letter, 'A');
    assert.equal(labeled[0].text, 'Drop-off loaner car or van supplied');
    assert.equal(labeled[1].text, 'CHECK ENGINE LIGHT ON');
  });

  test('Line A ignores OCR garbage merged from above the complaint header', () => {
    const text = `RO 482910 JOHN SMITH W1N4N4HB5NJ123456 LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS Drop-off loaner car or van supplied
# B
CHECK ENGINE LIGHT ON`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.equal(labeled[0].letter, 'A');
    assert.equal(labeled[0].text, 'Drop-off loaner car or van supplied');
    assert.ok(!labeled[0].text.includes('W1N4N4HB5NJ123456'));
    assert.ok(!labeled[0].text.includes('JOHN SMITH'));
  });

  test('duplicate advisor Line B does not create a separate Line C', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION
# B
CUSTOMER STATES CHECK ENGINE LIGHT ON
# B
CUSTOMER STATES CHECK ENGINE LIGHT ON
# C
NOISE FROM REAR`;
    const labeled = extractLetterLabeledComplaintsWithLabels(text);
    assert.deepEqual(
      labeled.map((item) => item.letter),
      ['A', 'B', 'C']
    );
    assert.equal(labeled[1].text, 'CHECK ENGINE LIGHT ON');
    assert.equal(labeled[2].text, 'NOISE FROM REAR');
  });

  test('page 2 carryover before # F attaches to Line E not Line F', () => {
    const text = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
# A
STATE INSPECTION
# B
CHECK ENGINE LIGHT ON
# C
NOISE FROM REAR
# D
BRAKE PULSATION
# E
QUALITY CONTROL INSP

=== PAGE 2 ===
ECTION STILL PENDING FINAL DETAIL
# F
SUNROOF WIND NOISE`;

    const recovered = recoverComplaintsWithLabelsFromText(text);
    assert.deepEqual(recovered.labels, ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.ok(recovered.complaints[4].includes('QUALITY CONTROL'));
    assert.ok(recovered.complaints[4].includes('ECTION STILL PENDING FINAL DETAIL'));
    assert.equal(recovered.complaints[5], 'SUNROOF WIND NOISE');
  });

  test('does not copy duplicate Line B text onto Line A when A is recovered from header', () => {
    const ocrText = `LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS Drop-off loaner car or van supplied
# B
CUSTOMER STATES CHECK ENGINE LIGHT ON
# B
CUSTOMER STATES CHECK ENGINE LIGHT ON`;

    const grokExtracted = parseStructuredROText(`Customer Complaints:
A. Drop-off loaner car or van supplied
B. CHECK ENGINE LIGHT ON`);

    const merged = mergeROExtractions(grokExtracted, parseStructuredROText(ocrText), ocrText);
    assert.equal(merged.complaints[0], 'Drop-off loaner car or van supplied');
    assert.equal(merged.complaints[1], 'CHECK ENGINE LIGHT ON');
    assert.notEqual(merged.complaints[0], merged.complaints[1]);
  });

  test('mergeROExtractions prefers non-empty service advisor name', () => {
    const grokParsed = {
      ...parseStructuredROText(GROK_OUTPUT_MISSING_A),
      serviceAdvisorName: 'Maria Lopez',
    };
    const ocrParsed = parseStructuredROText(
      'Service Advisor: JORDAN REYES\n' + COLLAPSED_OCR_LINE
    );
    const merged = mergeROExtractions(grokParsed, ocrParsed, COLLAPSED_OCR_LINE);
    assert.equal(merged.serviceAdvisorName, 'Maria Lopez');
    assert.equal(extractServiceAdvisorFromText('Service Advisor: JORDAN REYES'), 'JORDAN REYES');
  });

  test('mergeMultiPassOcrExtractions favors VIN agreed on by two passes', () => {
    const sharedVin = 'W1KZF8DB5LA123456';
    const passA = parseStructuredROText(
      `RO Number: 452891\nVIN: ${sharedVin}\nMileage In: 42150\nCustomer Name: JOHN SMITH`
    );
    const passB = parseStructuredROText(
      `RO# 452891\nVehicle VIN ${sharedVin}\nOdometer: 42150\nCustomer: JOHN SMITH`
    );
    const passC = parseStructuredROText(
      'RO Number: 452891\nVIN: W1KZF8DB5LA999999\nMileage In: 42150\nCustomer Name: JOHN SMITH'
    );

    const merged = mergeMultiPassOcrExtractions([passA, passB, passC]);
    assert.equal(merged.roNumber, '452891');
    assert.equal(merged.vehicle.vin, sharedVin);
    assert.equal(merged.vehicle.mileageIn, '42150');
    assert.equal(merged.customerName, 'JOHN SMITH');
  });

  test('mergeMultiPassOcrExtractions rejects lone hallucinated VIN when passes disagree', () => {
    const passA = parseStructuredROText('RO Number: 452891\nVIN: W1KZF8DB5LA123456');
    const passB = parseStructuredROText('RO Number: 452891\nVIN: W1KZF8DB5LA654321');

    const merged = mergeMultiPassOcrExtractions([passA, passB]);
    assert.equal(merged.roNumber, '452891');
    assert.equal(merged.vehicle.vin, '');
  });

  test('mergeScanSources cross-validates Grok and OCR while preserving complaint labels', () => {
    const grok = parseStructuredROText(
      `RO Number: 452891
Customer Name: JOHN SMITH
Year: 2020
Make: Mercedes-Benz
Model: GLE350
VIN: W1KZF8DB5LA123456
Mileage IN: 42150
Customer Complaints:
A. CHECK ENGINE LIGHT ON`
    );
    const ocrText = `RO# 452891
Customer: JOHN SMITH
VIN W1KZF8DB5LA123456
Mileage In: 42150
LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS # A RHODE ISLAND STATE INSPECTION
# B CHECK ENGINE LIGHT ON`;
    const ocr = parseStructuredROText(ocrText);

    const merged = mergeScanSources(grok, ocr, ocrText);
    assert.equal(merged.roNumber, '452891');
    assert.equal(merged.vehicle.vin, 'W1KZF8DB5LA123456');
    assert.equal(merged.complaints.length >= 2, true);
    assert.equal(merged.complaintLabels?.includes('A'), true);
    assert.equal(merged.complaintLabels?.includes('B'), true);
  });
});