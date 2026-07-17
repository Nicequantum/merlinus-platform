-- Phase 7.3 — per-rooftop timezone + hot-path composite indexes

-- Dealership timezone (IANA), default America/New_York
ALTER TABLE "Dealership" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/New_York';

-- Optional DealerGroup default timezone for new rooftops / reporting
ALTER TABLE "DealerGroup" ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'America/New_York';

-- Technician active-staff lookups
CREATE INDEX IF NOT EXISTS "Technician_dealershipId_isActive_deletedAt_idx"
  ON "Technician"("dealershipId", "isActive", "deletedAt");

-- RO list / advisor metrics windows
CREATE INDEX IF NOT EXISTS "RepairOrder_dealershipId_updatedAt_idx"
  ON "RepairOrder"("dealershipId", "updatedAt");

CREATE INDEX IF NOT EXISTS "RepairOrder_dealershipId_serviceAdvisorId_updatedAt_idx"
  ON "RepairOrder"("dealershipId", "serviceAdvisorId", "updatedAt");

-- Audit owner summary + image.upload grants
CREATE INDEX IF NOT EXISTS "AuditLog_dealershipId_action_createdAt_idx"
  ON "AuditLog"("dealershipId", "action", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_dealershipId_technicianId_action_createdAt_idx"
  ON "AuditLog"("dealershipId", "technicianId", "action", "createdAt");
