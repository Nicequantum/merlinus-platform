import { decryptSensitiveText } from '@/lib/encryption';
import {
  HUB_CATEGORY_LABELS,
  HUB_STATUS_LABELS,
  type HubAppointmentCategory,
  type HubAppointmentStatus,
} from '@/lib/hub/constants';

export type AppointmentRow = {
  id: string;
  dealershipId: string;
  title: string;
  category: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  customerNameEncrypted: string;
  customerPhoneEncrypted: string;
  customerPhoneLast4: string;
  vehicleLabel: string | null;
  vinLast8: string | null;
  notesEncrypted: string;
  advisorName: string | null;
  source: string;
  voiceCallId: string | null;
  departmentRequestId: string | null;
  shareTokenHash: string | null;
  shareExpiresAt: Date | null;
  createdByTechnicianId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapAppointmentDto(row: AppointmentRow, options?: { includePii?: boolean }) {
  const includePii = options?.includePii !== false;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    categoryLabel:
      HUB_CATEGORY_LABELS[row.category as HubAppointmentCategory] || row.category,
    status: row.status,
    statusLabel: HUB_STATUS_LABELS[row.status as HubAppointmentStatus] || row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    customerName: includePii ? decryptSensitiveText(row.customerNameEncrypted || '') : null,
    customerPhone: includePii ? decryptSensitiveText(row.customerPhoneEncrypted || '') : null,
    customerPhoneLast4: row.customerPhoneLast4 || null,
    vehicleLabel: row.vehicleLabel,
    vinLast8: row.vinLast8,
    notes: includePii ? decryptSensitiveText(row.notesEncrypted || '') : null,
    advisorName: row.advisorName,
    source: row.source,
    voiceCallId: row.voiceCallId,
    departmentRequestId: row.departmentRequestId,
    hasShareLink: Boolean(row.shareTokenHash),
    shareExpiresAt: row.shareExpiresAt?.toISOString() ?? null,
    createdByTechnicianId: row.createdByTechnicianId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type TimelineItem =
  | {
      kind: 'appointment';
      id: string;
      sortAt: string;
      appointment: ReturnType<typeof mapAppointmentDto>;
    }
  | {
      kind: 'call';
      id: string;
      sortAt: string;
      call: {
        id: string;
        status: string;
        fromLast4: string;
        toE164: string;
        durationSec: number | null;
        outcome: string | null;
        contained: boolean | null;
        activeAgent: string | null;
        agentDisplayName: string | null;
        routingPath: string[];
        tags: string[];
        customerName: string | null;
        vehicleLabel: string | null;
        sentiment: string | null;
        primaryIntent: string | null;
        summary: string | null;
        keyPoints: string[];
        hasInsight: boolean;
        hasRecording: boolean;
        recordingStatus: string | null;
        suggestedAppointment: Record<string, unknown> | null;
        createdAt: string;
      };
    };

export function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
