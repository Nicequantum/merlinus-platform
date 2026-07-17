import {
  enrichScannedRepairLinesWithCustomerPayTemplates,
  filterScannedComplaintsForProcessing,
} from '@/lib/scanPipeline';
import type { RepairLine, RepairOrder, VehicleInfo } from '../types';
import { emptyExtractedData } from './diagnosticParser';

function defaultRepairLine(complaint?: string, lineNumber = 1, label?: string): RepairLine {
  const concern = complaint || '';
  const prefix = label ? `${label}. ` : '';
  const description = concern
    ? `${prefix}${concern}`.slice(0, 72)
    : label
      ? `${label}. (not extracted — tap to edit)`
      : 'Enter repair description';
  return {
    id: `line-${Date.now()}-${lineNumber}`,
    lineNumber,
    description,
    customerConcern: concern,
    technicianNotes: '',
    xentryImages: [],
    xentryOcrTexts: [],
    extractedData: emptyExtractedData(),
  };
}

/** Keep repair lines aligned with complaint list — one clickable line per concern. */
export function syncRepairLinesWithComplaints(
  existingLines: RepairLine[],
  complaints: string[],
  complaintLabels?: string[]
): RepairLine[] {
  if (complaints.length === 0) {
    return existingLines.length > 0 ? existingLines : [defaultRepairLine()];
  }

  const baseId = Date.now();
  return complaints.map((complaint, index) => {
    const lineNumber = index + 1;
    const label = complaintLabels?.[index] || String.fromCharCode(65 + index);
    const prior = existingLines[index];
    const concern = complaint || '';
    const prefix = `${label}. `;
    const description = concern
      ? `${prefix}${concern}`.slice(0, 72)
      : `${label}. (not extracted — tap to edit)`;

    if (prior) {
      const concernChanged = prior.customerConcern !== concern;
      const descLooksAuto =
        !prior.description ||
        prior.description === 'Enter repair description' ||
        prior.description === 'New repair item' ||
        prior.description.startsWith(`${label}. `) ||
        prior.description === prior.customerConcern?.slice(0, 60) ||
        prior.description === prior.customerConcern?.slice(0, 72);
      return {
        ...prior,
        lineNumber,
        customerConcern: concern,
        description: concernChanged || descLooksAuto ? description : prior.description,
      };
    }

    return {
      ...defaultRepairLine(concern, lineNumber, label),
      id: `line-${baseId}-${lineNumber}`,
    };
  });
}

export async function createRepairOrderFromScan(params: {
  roNumber: string;
  vehicle: VehicleInfo;
  customerName: string;
  complaints: string[];
  complaintLabels?: string[];
  serviceAdvisorName?: string;
}): Promise<RepairOrder> {
  const filtered = filterScannedComplaintsForProcessing(
    params.complaints,
    params.complaintLabels
  );
  const labels = filtered.complaintLabels;
  const complaints = filtered.complaints;
  const repairLines = await enrichScannedRepairLinesWithCustomerPayTemplates(
    complaints.length > 0
      ? complaints.map((complaint, i) => defaultRepairLine(complaint, i + 1, labels[i]))
      : [defaultRepairLine()],
    complaints,
    labels
  );

  return {
    id: 'ro-' + Date.now(),
    roNumber: params.roNumber,
    vehicle: { ...params.vehicle, engine: params.vehicle.engine || '' },
    customer: { name: params.customerName },
    complaints,
    complaintLabels: labels,
    serviceAdvisorName: params.serviceAdvisorName,
    xentryImages: [],
    xentryOcrTexts: [],
    createdAt: new Date().toISOString(),
    repairLines,
  };
}

export function createManualRepairOrder(): RepairOrder {
  const roId = 'ro-' + Date.now();
  return {
    id: roId,
    roNumber: `R-${Date.now().toString().slice(-6)}`,
    vehicle: { vin: '', year: '', make: '', model: '', engine: '', mileageIn: '', mileageOut: '' },
    customer: { name: '' },
    complaints: [''],
    complaintLabels: ['A'],
    complaintIds: [`cmp-${roId}-A`],
    xentryImages: [],
    xentryOcrTexts: [],
    createdAt: new Date().toISOString(),
    repairLines: [defaultRepairLine()],
  };
}

export function ensureComplaintIds(ro: RepairOrder): RepairOrder {
  const labels = ro.complaintLabels ?? ro.complaints.map((_, i) => String.fromCharCode(65 + i));
  const ids =
    ro.complaintIds && ro.complaintIds.length === ro.complaints.length
      ? ro.complaintIds
      : labels.map((label, i) => ro.complaintIds?.[i] ?? `cmp-${ro.id}-${label}`);
  return { ...ro, complaintLabels: labels, complaintIds: ids };
}

export function createNewRepairLine(lineNumber: number): RepairLine {
  return {
    id: 'line-' + Date.now(),
    lineNumber,
    description: 'New repair item',
    customerConcern: '',
    technicianNotes: '',
    xentryImages: [],
    xentryOcrTexts: [],
    extractedData: emptyExtractedData(),
  };
}