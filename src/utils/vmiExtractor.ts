import type { VehicleWarrantyInfo } from '../types';

const DATE_PATTERN =
  /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/;

function captureLabeledValue(text: string, labels: RegExp[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label.source}\\s*[:\\-]?\\s*([^\\n]{4,80})`, 'i'));
    if (match?.[1]) {
      return match[1].replace(/\s{2,}/g, ' ').trim();
    }
  }
  return '';
}

function captureDateNearLabel(text: string, labels: RegExp[]): string {
  for (const label of labels) {
    const match = text.match(
      new RegExp(`${label.source}[^\\n]{0,40}?(${DATE_PATTERN.source})`, 'i')
    );
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

/** Extract warranty / service-history fields from a VMI document OCR pass. */
export function extractVmiWarrantyInfo(text: string): VehicleWarrantyInfo {
  if (!text?.trim()) return {};

  const normalized = text.replace(/\r\n/g, '\n');

  const factoryWarranty =
    captureDateNearLabel(normalized, [/factory\s+warranty/i, /new\s+vehicle\s+warranty/i]) ||
    captureLabeledValue(normalized, [/factory\s+warranty/i, /new\s+vehicle\s+warranty/i]);

  const cpoWarranty =
    captureDateNearLabel(normalized, [/cpo\s+warranty/i, /certified\s+pre[- ]?owned/i]) ||
    captureLabeledValue(normalized, [/cpo\s+warranty/i, /certified\s+pre[- ]?owned/i]);

  const extendedElaWarranty =
    captureDateNearLabel(normalized, [/extended\s+ela/i, /ela\s+warranty/i, /extended\s+warranty/i]) ||
    captureLabeledValue(normalized, [/extended\s+ela/i, /ela\s+warranty/i, /extended\s+warranty/i]);

  const serviceHistoryNotes = captureLabeledValue(normalized, [
    /service\s+history/i,
    /last\s+service/i,
    /recent\s+service/i,
  ]);

  const info: VehicleWarrantyInfo = {};
  if (factoryWarranty) info.factoryWarranty = factoryWarranty;
  if (cpoWarranty) info.cpoWarranty = cpoWarranty;
  if (extendedElaWarranty) info.extendedElaWarranty = extendedElaWarranty;
  if (serviceHistoryNotes) info.serviceHistoryNotes = serviceHistoryNotes;

  return info;
}

export function mergeVehicleWarrantyInfo(
  primary: VehicleWarrantyInfo = {},
  supplement: VehicleWarrantyInfo = {}
): VehicleWarrantyInfo {
  return {
    factoryWarranty: primary.factoryWarranty || supplement.factoryWarranty,
    cpoWarranty: primary.cpoWarranty || supplement.cpoWarranty,
    extendedElaWarranty: primary.extendedElaWarranty || supplement.extendedElaWarranty,
    serviceHistoryNotes: primary.serviceHistoryNotes || supplement.serviceHistoryNotes,
  };
}