-- Unified Calendar & Conversation Hub

CREATE TABLE IF NOT EXISTS "ServiceAppointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'service',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "vehicleLabel" TEXT,
    "vinLast8" TEXT,
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "advisorName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "voiceCallId" TEXT,
    "departmentRequestId" TEXT,
    "shareTokenHash" TEXT,
    "shareExpiresAt" DATETIME,
    "createdByTechnicianId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceAppointment_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAppointment_shareTokenHash_key" ON "ServiceAppointment"("shareTokenHash");
CREATE INDEX IF NOT EXISTS "ServiceAppointment_dealershipId_startsAt_idx" ON "ServiceAppointment"("dealershipId", "startsAt");
CREATE INDEX IF NOT EXISTS "ServiceAppointment_dealershipId_status_startsAt_idx" ON "ServiceAppointment"("dealershipId", "status", "startsAt");
CREATE INDEX IF NOT EXISTS "ServiceAppointment_dealershipId_category_idx" ON "ServiceAppointment"("dealershipId", "category");
CREATE INDEX IF NOT EXISTS "ServiceAppointment_voiceCallId_idx" ON "ServiceAppointment"("voiceCallId");

CREATE TABLE IF NOT EXISTS "ConversationInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "voiceCallId" TEXT NOT NULL,
    "summaryEncrypted" TEXT NOT NULL DEFAULT '',
    "keyPointsJson" TEXT NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "primaryIntent" TEXT,
    "suggestedAppointmentJson" TEXT NOT NULL DEFAULT '{}',
    "outcome" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'hub-insight-v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationInsight_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationInsight_voiceCallId_key" ON "ConversationInsight"("voiceCallId");
CREATE INDEX IF NOT EXISTS "ConversationInsight_dealershipId_createdAt_idx" ON "ConversationInsight"("dealershipId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationInsight_dealershipId_primaryIntent_idx" ON "ConversationInsight"("dealershipId", "primaryIntent");

CREATE TABLE IF NOT EXISTS "HubAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "technicianId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HubAuditEvent_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "HubAuditEvent_dealershipId_createdAt_idx" ON "HubAuditEvent"("dealershipId", "createdAt");
CREATE INDEX IF NOT EXISTS "HubAuditEvent_dealershipId_entityType_entityId_idx" ON "HubAuditEvent"("dealershipId", "entityType", "entityId");
