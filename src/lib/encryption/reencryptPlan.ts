/**
 * Full AES re-encrypt inventory (P0-1).
 * Shared by rotationService (runtime walk), UI coverage, health, and unit tests.
 * Keep in sync with every `*Encrypted` field in prisma/schema.prisma.
 *
 * Not server-only so tests and clients can read coverage metadata without pulling
 * the full rotation control plane.
 */

export type ReencryptTablePlanEntry = {
  /** Prisma client model accessor, e.g. repairOrder, userMfa */
  table: string;
  idField: string;
  columns: string[];
  /** UI / ops label */
  label: string;
};

/**
 * Tables/columns walked during dual-key re-encrypt.
 * MFA is first-class (UserMfa + Technician denormalized mirrors).
 * Blind-index tokens (e.g. roNumberSearchTokens) are HMAC, not AES — excluded.
 */
export const REENCRYPT_TABLE_PLAN: ReencryptTablePlanEntry[] = [
  {
    table: 'repairOrder',
    idField: 'id',
    label: 'Repair orders',
    columns: [
      'vinEncrypted',
      'customerNameEncrypted',
      'complaintsEncrypted',
      'xentryOcrTextsEncrypted',
      'serviceAdvisorNameEncrypted',
      'roNumberEncrypted',
    ],
  },
  {
    table: 'repairLine',
    idField: 'id',
    label: 'Repair lines',
    columns: [
      'descriptionEncrypted',
      'customerConcernEncrypted',
      'technicianNotesEncrypted',
      'xentryOcrTextsEncrypted',
      'extractedDataEncrypted',
      'warrantyStoryEncrypted',
      'storyQualityAuditEncrypted',
      'storyCertifiedByNameEncrypted',
    ],
  },
  {
    table: 'serviceAdvisor',
    idField: 'id',
    label: 'Service advisors',
    columns: ['displayNameEncrypted'],
  },
  {
    table: 'advisorComplaintObservation',
    idField: 'id',
    label: 'Advisor complaint observations',
    columns: ['complaintTextEncrypted'],
  },
  {
    table: 'advisorWritingProfile',
    idField: 'id',
    label: 'Advisor writing profiles',
    columns: ['profileDataEncrypted'],
  },
  {
    table: 'aiJob',
    idField: 'id',
    label: 'AI jobs',
    columns: ['resultEncrypted'],
  },
  {
    table: 'userMfa',
    idField: 'id',
    label: 'MFA (UserMfa)',
    columns: ['secretEncrypted', 'backupCodesEncrypted'],
  },
  {
    table: 'technician',
    idField: 'id',
    label: 'Technician MFA mirrors',
    columns: ['mfaSecretEncrypted', 'mfaBackupCodesEncrypted'],
  },
  {
    table: 'videoInspection',
    idField: 'id',
    label: 'Video inspections',
    columns: [
      'transcriptEncrypted',
      'reportEncrypted',
      'customerNameEncrypted',
      'customerPhoneEncrypted',
      'vinEncrypted',
    ],
  },
  {
    table: 'videoInspectionFinding',
    idField: 'id',
    label: 'Video inspection findings',
    columns: ['noteEncrypted'],
  },
  {
    table: 'videoInspectionSmsLog',
    idField: 'id',
    label: 'Video SMS logs',
    columns: ['phoneEncrypted'],
  },
  {
    table: 'departmentRequest',
    idField: 'id',
    label: 'Department requests',
    columns: [
      'summaryEncrypted',
      'customerNameEncrypted',
      'customerPhoneEncrypted',
      'customerEmailEncrypted',
      'vinEncrypted',
    ],
  },
  {
    table: 'partsRequestLine',
    idField: 'id',
    label: 'Parts request lines',
    columns: ['notesEncrypted'],
  },
  {
    table: 'maintenanceTicket',
    idField: 'id',
    label: 'Maintenance tickets',
    columns: ['descriptionEncrypted'],
  },
  {
    table: 'maintenanceTicketEvent',
    idField: 'id',
    label: 'Maintenance ticket events',
    columns: ['payloadEncrypted'],
  },
  {
    table: 'loanerVehicle',
    idField: 'id',
    label: 'Loaner vehicles',
    columns: ['vinEncrypted', 'plateEncrypted', 'notesEncrypted'],
  },
  {
    table: 'loanerAssignment',
    idField: 'id',
    label: 'Loaner assignments',
    columns: ['customerNameEncrypted', 'customerPhoneEncrypted', 'notesEncrypted'],
  },
  {
    table: 'voiceCall',
    idField: 'id',
    label: 'Voice calls',
    columns: ['fromEncrypted', 'transcriptEncrypted'],
  },
  {
    table: 'voiceTranscriptSegment',
    idField: 'id',
    label: 'Voice transcript segments',
    columns: ['textEncrypted'],
  },
  {
    table: 'serviceAppointment',
    idField: 'id',
    label: 'Service appointments',
    columns: ['customerNameEncrypted', 'customerPhoneEncrypted', 'notesEncrypted'],
  },
  {
    table: 'conversationInsight',
    idField: 'id',
    label: 'Conversation insights',
    columns: ['summaryEncrypted'],
  },
  {
    table: 'template',
    idField: 'id',
    label: 'Templates',
    columns: ['contentEncrypted'],
  },
  {
    table: 'knowledgeBase',
    idField: 'id',
    label: 'Knowledge base',
    columns: ['generatedTextEncrypted', 'fullOriginalTextEncrypted', 'cleanTemplateEncrypted'],
  },
];

/** MFA-related plan entries — used by health probe after rotation. */
export const MFA_REENCRYPT_TABLES = ['userMfa', 'technician'] as const;

export function getReencryptCoverageSummary(): {
  tableCount: number;
  columnCount: number;
  tables: Array<{ table: string; label: string; columns: string[] }>;
  includesMfa: boolean;
  planVersion: string;
} {
  const tables = REENCRYPT_TABLE_PLAN.map((p) => ({
    table: p.table,
    label: p.label,
    columns: [...p.columns],
  }));
  const columnCount = REENCRYPT_TABLE_PLAN.reduce((n, p) => n + p.columns.length, 0);
  return {
    tableCount: REENCRYPT_TABLE_PLAN.length,
    columnCount,
    tables,
    includesMfa: MFA_REENCRYPT_TABLES.every((t) =>
      REENCRYPT_TABLE_PLAN.some((p) => p.table === t)
    ),
    planVersion: 'v4.1.0-full-aes',
  };
}
