import { ApiError } from '@/lib/api';
import { GENERIC_ERROR } from '@/lib/errors';
import { CUSTOMER_PAY_TEMPLATES } from '@/prompts/templates/customerPayTemplates';
import type { RepairLine, StructuredROExtraction } from '@/types';

/** Technician-facing message from a failed scan/extract API call — always prefer server text. */
export function formatScanApiError(error: unknown, fallback?: string): string {
  if (error instanceof ApiError) {
    const msg = error.message?.trim();
    if (msg) {
      if (msg === GENERIC_ERROR) {
        return `Scan failed (HTTP ${error.status}): ${msg}`;
      }
      return msg;
    }
    return fallback
      ? `${fallback} (HTTP ${error.status})`
      : `Scan request failed (HTTP ${error.status}).`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback ?? 'Scan failed — no error details returned from server.';
}

export function isRetriableScanMessage(message: string): boolean {
  return /timed out|busy|unavailable|try again/i.test(message);
}

/** Grok returned enough structured data — skip waiting for slow on-device OCR. */
export function isStrongGrokExtraction(grok: StructuredROExtraction | null): boolean {
  if (!grok) return false;
  return assessRoExtractionQuality(grok).extractionStrength === 'strong';
}

export type RoExtractionStrength = 'strong' | 'partial' | 'weak';

export interface RoExtractionQualitySignals {
  extractionStrength: RoExtractionStrength;
  complaintCount: number;
  complaintLabelCount: number;
  hasRoNumber: boolean;
  hasVin17: boolean;
  hasVehicleIdentity: boolean;
}

/** PII-free quality signals for ro.extract audit metadata and scan telemetry. */
export function assessRoExtractionQuality(extracted: StructuredROExtraction): RoExtractionQualitySignals {
  const complaints = extracted.complaints?.filter((line) => line?.trim()) ?? [];
  const complaintCount = complaints.length;
  const complaintLabelCount = extracted.complaintLabels?.filter((l) => l?.trim()).length ?? 0;
  const hasRoNumber = Boolean(extracted.roNumber?.trim());
  const hasVin17 = (extracted.vehicle?.vin?.trim() ?? '').length === 17;
  const hasVehicleIdentity = Boolean(
    extracted.vehicle?.year?.trim() && extracted.vehicle?.make?.trim()
  );

  let extractionStrength: RoExtractionStrength = 'weak';
  if (complaintCount > 0 || (hasRoNumber && hasVin17)) {
    extractionStrength = 'strong';
  } else if (complaintCount > 0 || hasRoNumber || hasVin17 || hasVehicleIdentity) {
    extractionStrength = 'partial';
  }

  return {
    extractionStrength,
    complaintCount,
    complaintLabelCount,
    hasRoNumber,
    hasVin17,
    hasVehicleIdentity,
  };
}

// ---------------------------------------------------------------------------
// Legacy B-service filter + Customer Pay scan template matching
// ---------------------------------------------------------------------------

export interface ScannedServiceLine {
  code: string;
  text: string;
}

export interface CustomerPayScanTemplateMatch {
  templateTitle: string;
  preWrittenStory: string;
}

function normalizeScanMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identity pass for scanned RO lines (legacy name retained for call sites / tests).
 *
 * Historical note: an older filter skipped letter-code "B" and treated some menu
 * packages as non-warranty-only. All lettered RO lines — including B Service /
 * A Service / Customer Pay menu items — now pass through unchanged so they appear
 * on the RO review screen with their printed text.
 */
export function filterLegacyScannedServiceLines<T extends ScannedServiceLine>(lines: T[]): T[] {
  return [...lines];
}

/** Pair complaints with letter codes — no content filtering (all RO lines retained). */
export function filterScannedComplaintsForProcessing(
  complaints: string[],
  complaintLabels?: string[]
): { complaints: string[]; complaintLabels: string[] } {
  const labels =
    complaintLabels?.length === complaints.length
      ? complaintLabels
      : complaints.map((_, index) => String.fromCharCode(65 + index));

  // Explicitly keep every pair; do not drop by letter code or menu/customer-pay text.
  return {
    complaints: complaints.map((text) => text ?? ''),
    complaintLabels: labels.map((code) => code ?? ''),
  };
}

function scoreCustomerPayTemplateMatch(scanText: string, templateTitle: string): number {
  const normalized = normalizeScanMatchText(scanText);
  if (normalized.length < 6) return 0;

  const titleNorm = normalizeScanMatchText(templateTitle);
  if (normalized.includes(titleNorm)) return 1000 + titleNorm.length;

  const titleTokens = titleNorm.split(' ').filter((token) => token.length > 2);
  if (titleTokens.length === 0) return 0;

  const matchedTokens = titleTokens.filter((token) => normalized.includes(token));
  if (matchedTokens.length === 0) return 0;

  const coverage = matchedTokens.length / titleTokens.length;
  if (coverage < 0.66) return 0;

  // Guardrail: disambiguate front vs rear brake templates on partial matches.
  if (titleNorm.includes('front brake') && normalized.includes('rear') && !normalized.includes('front')) {
    return 0;
  }
  if (titleNorm.includes('rear brake') && normalized.includes('front') && !normalized.includes('rear')) {
    return 0;
  }
  if (titleNorm.includes('mercedes benz brake fluid') && !/(mercedes|benz|mb)\b/.test(normalized)) {
    return 0;
  }
  if (titleNorm.includes('standard brake fluid') && /(mercedes|benz|mb)\b/.test(normalized)) {
    return 0;
  }
  if (titleNorm.includes('auxiliary battery') && normalized.includes('main') && !normalized.includes('auxiliary')) {
    return 0;
  }
  if (titleNorm.includes('main battery') && normalized.includes('auxiliary') && !normalized.includes('main')) {
    return 0;
  }
  if (titleNorm.includes('flat tire repair') && normalized.includes('replace') && !normalized.includes('repair')) {
    return 0;
  }
  if (titleNorm.includes('tire replacement') && normalized.includes('repair') && !normalized.includes('replace')) {
    return 0;
  }
  if (titleNorm.includes('headlight bulb') && normalized.includes('tail') && !normalized.includes('head')) {
    return 0;
  }
  if (titleNorm.includes('taillight bulb') && normalized.includes('head') && !normalized.includes('tail')) {
    return 0;
  }
  if (titleNorm.includes('dome light') && normalized.includes('headlight')) {
    return 0;
  }
  if (titleNorm.includes('cabin air filter') && normalized.includes('engine air') && !normalized.includes('cabin')) {
    return 0;
  }
  if (titleNorm.includes('engine air filter') && normalized.includes('cabin') && !normalized.includes('engine')) {
    return 0;
  }
  if (titleNorm.includes('battery test') && normalized.includes('replace') && !normalized.includes('test')) {
    return 0;
  }

  return Math.round(matchedTokens.reduce((sum, token) => sum + token.length, 0) * coverage);
}

export interface GenerateDynamicCustomerPayNarrativeInput {
  templateTitle: string;
  baseTemplate: string;
  customerComplaint: string;
}

/**
 * Dynamic Customer Pay templating — light Grok variation of a matched base template.
 * Server-only Grok call; returns the base template unchanged on client or when Grok fails.
 */
export async function generateDynamicCustomerPayNarrative(
  input: GenerateDynamicCustomerPayNarrativeInput
): Promise<string> {
  const baseTemplate = input.baseTemplate?.trim() ?? '';
  if (!baseTemplate) return baseTemplate;
  if (typeof window !== 'undefined') return baseTemplate;

  try {
    const { generateDynamicCustomerPayNarrative: generateWithGrok } = await import('@/lib/grok');
    return await generateWithGrok(input);
  } catch {
    return baseTemplate;
  }
}

function isCustomerPayEligibleForDynamicStory(line: RepairLine): boolean {
  return !line.isCustomerPay && !line.warrantyStory?.trim();
}

/** Match a scanned line to a defined Customer Pay template, if any. */
export function matchCustomerPayTemplateFromScanText(scanText: string): CustomerPayScanTemplateMatch | null {
  const trimmed = scanText?.trim() ?? '';
  if (trimmed.length < 6) return null;

  let best: CustomerPayScanTemplateMatch | null = null;
  let bestScore = 0;

  for (const template of CUSTOMER_PAY_TEMPLATES) {
    const score = scoreCustomerPayTemplateMatch(trimmed, template.title);
    if (score > bestScore) {
      bestScore = score;
      best = { templateTitle: template.title, preWrittenStory: template.preWrittenStory };
    }
  }

  return bestScore >= 8 ? best : null;
}

/**
 * Apply Customer Pay narratives to scanned repair lines when scan text matches a defined template.
 * Uses generateDynamicCustomerPayNarrative for light Grok variation tied to the customer complaint.
 * Guardrails: only unmatched-warranty lines with no existing story; warranty lines are never modified.
 */
export async function enrichScannedRepairLinesWithCustomerPayTemplates(
  repairLines: RepairLine[],
  complaints: string[],
  complaintLabels?: string[]
): Promise<RepairLine[]> {
  const { complaints: filteredComplaints } = filterScannedComplaintsForProcessing(
    complaints,
    complaintLabels
  );

  const enriched: RepairLine[] = [];

  for (let index = 0; index < repairLines.length; index += 1) {
    const line = repairLines[index];
    if (!isCustomerPayEligibleForDynamicStory(line)) {
      enriched.push(line);
      continue;
    }

    const scanText = [filteredComplaints[index], line.customerConcern, line.description]
      .filter(Boolean)
      .join(' ');

    const match = matchCustomerPayTemplateFromScanText(scanText);
    if (!match) {
      enriched.push(line);
      continue;
    }

    const warrantyStory = await generateDynamicCustomerPayNarrative({
      templateTitle: match.templateTitle,
      baseTemplate: match.preWrittenStory,
      customerComplaint: scanText,
    });

    enriched.push({
      ...line,
      warrantyStory,
      isCustomerPay: true,
    });
  }

  return enriched;
}