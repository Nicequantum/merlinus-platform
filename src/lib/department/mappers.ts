import { decryptSensitiveText } from '@/lib/encryption';
import { last8OfVin, phoneLast4 } from '@/lib/department/piiHelpers';

export type PartsLineRow = {
  id: string;
  partNumber: string | null;
  description: string;
  qty: number;
  status: string;
  quotedPriceCents: number | null;
  vendor: string | null;
  notesEncrypted: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PartsLookupRow = {
  id: string;
  query: string;
  resultJson: string;
  source: string;
  createdById: string | null;
  createdAt: Date;
  createdBy?: { name: string } | null;
};

export type DepartmentRequestRow = {
  id: string;
  dealershipId: string;
  dealerId: string | null;
  department: string;
  source: string;
  status: string;
  priority: string;
  subject: string;
  summaryEncrypted: string;
  customerNameEncrypted: string;
  customerPhoneEncrypted: string;
  customerPhoneLast4: string;
  customerEmailEncrypted: string;
  vinEncrypted: string;
  vinLast8: string | null;
  vehicleLabel: string | null;
  stockOrRoHint: string | null;
  voiceCallId: string | null;
  createdById: string | null;
  assignedToId: string | null;
  metadataJson: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { name: string } | null;
  assignedTo?: { name: string } | null;
  partsLines?: PartsLineRow[];
  partsLookups?: PartsLookupRow[];
};

export function mapPartsLine(row: PartsLineRow) {
  return {
    id: row.id,
    partNumber: row.partNumber,
    description: row.description,
    qty: row.qty,
    status: row.status,
    quotedPriceCents: row.quotedPriceCents,
    vendor: row.vendor,
    notes: decryptSensitiveText(row.notesEncrypted || ''),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapPartsLookup(row: PartsLookupRow) {
  let result: unknown = {};
  try {
    result = JSON.parse(row.resultJson || '{}');
  } catch {
    result = {};
  }
  return {
    id: row.id,
    query: row.query,
    result,
    source: row.source,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapDepartmentRequestSummary(row: DepartmentRequestRow) {
  return {
    id: row.id,
    department: row.department,
    source: row.source,
    status: row.status,
    priority: row.priority,
    subject: row.subject,
    vehicleLabel: row.vehicleLabel,
    vinLast8: row.vinLast8,
    customerPhoneLast4: row.customerPhoneLast4 || null,
    stockOrRoHint: row.stockOrRoHint,
    assignedToId: row.assignedToId,
    assignedToName: row.assignedTo?.name ?? null,
    createdByName: row.createdBy?.name ?? null,
    partsLineCount: row.partsLines?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapDepartmentRequestDetail(row: DepartmentRequestRow) {
  return {
    ...mapDepartmentRequestSummary(row),
    summary: decryptSensitiveText(row.summaryEncrypted || ''),
    customerName: decryptSensitiveText(row.customerNameEncrypted || ''),
    customerPhone: decryptSensitiveText(row.customerPhoneEncrypted || ''),
    customerEmail: decryptSensitiveText(row.customerEmailEncrypted || ''),
    vin: decryptSensitiveText(row.vinEncrypted || ''),
    voiceCallId: row.voiceCallId,
    createdById: row.createdById,
    metadataJson: row.metadataJson || '{}',
    partsLines: (row.partsLines ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(mapPartsLine),
    partsLookups: (row.partsLookups ?? [])
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(mapPartsLookup),
  };
}

export { last8OfVin, phoneLast4 };
