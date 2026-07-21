-- P1-1 AiJob + P1-3 MFA columns (D1 / SQLite)
-- Keep in sync with prisma/schema.prisma

CREATE TABLE IF NOT EXISTS "AiJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dealershipId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "entityType" TEXT,
  "entityId" TEXT,
  "errorMessage" TEXT,
  "resultEncrypted" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiJob_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AiJob_dealershipId_technicianId_createdAt_idx"
  ON "AiJob"("dealershipId", "technicianId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiJob_dealershipId_status_createdAt_idx"
  ON "AiJob"("dealershipId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AiJob_entityType_entityId_idx"
  ON "AiJob"("entityType", "entityId");

-- MFA foundation (SQLite/D1: ADD COLUMN is additive; re-run may fail if columns exist)
ALTER TABLE "Technician" ADD COLUMN "mfa_enabled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Technician" ADD COLUMN "mfa_secret_encrypted" TEXT;
ALTER TABLE "Technician" ADD COLUMN "mfa_enrolled_at" DATETIME;
