-- APEX NATIONAL PLATFORM — Phase 5.1: Fortress schema foundation.
-- MERLINUS SINGLE-DEALER: backward compatible — existing technicians retain d7Number; no RLS enabled.
-- RLS policy templates: prisma/rls/apex_phase5_prepared_policies.sql (documentation only).

-- ─── TechnicianRole: add owner ───────────────────────────────────────────────
ALTER TYPE "TechnicianRole" ADD VALUE IF NOT EXISTS 'owner';

-- ─── Technician: apexUsername, nullable d7Number ─────────────────────────────
ALTER TABLE "Technician" ADD COLUMN IF NOT EXISTS "apexUsername" TEXT;

ALTER TABLE "Technician" DROP CONSTRAINT IF EXISTS "Technician_d7Number_key";
ALTER TABLE "Technician" ALTER COLUMN "d7Number" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Technician_d7Number_key"
  ON "Technician"("d7Number")
  WHERE "d7Number" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Technician_apexUsername_key"
  ON "Technician"("apexUsername")
  WHERE "apexUsername" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Technician_apexUsername_idx" ON "Technician"("apexUsername");

-- ─── Sentinel dealership for owner FK integrity ────────────────────────────
INSERT INTO "Dealership" ("id", "name", "dealer_id", "createdAt")
VALUES (
    '__apex_national__',
    'Apex National Platform',
    NULL,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- ─── AuditLog: auth source + scope mode ──────────────────────────────────────
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "auth_source" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "scope_mode" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_dealershipId_dealer_id_action_createdAt_idx"
  ON "AuditLog"("dealershipId", "dealer_id", "action", "createdAt");

-- ─── SessionRefreshToken — rotating refresh tokens (apex mode) ───────────────
CREATE TABLE IF NOT EXISTS "SessionRefreshToken" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionRefreshToken_tokenHash_key"
  ON "SessionRefreshToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "SessionRefreshToken_technicianId_idx"
  ON "SessionRefreshToken"("technicianId");

CREATE INDEX IF NOT EXISTS "SessionRefreshToken_familyId_idx"
  ON "SessionRefreshToken"("familyId");

CREATE INDEX IF NOT EXISTS "SessionRefreshToken_expiresAt_idx"
  ON "SessionRefreshToken"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SessionRefreshToken_technicianId_fkey'
  ) THEN
    ALTER TABLE "SessionRefreshToken"
      ADD CONSTRAINT "SessionRefreshToken_technicianId_fkey"
      FOREIGN KEY ("technicianId") REFERENCES "Technician"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS prep: composite tenant indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS "RepairOrder_dealershipId_dealer_id_updatedAt_idx"
  ON "RepairOrder"("dealershipId", "dealer_id", "updatedAt");

CREATE INDEX IF NOT EXISTS "ServiceAdvisor_dealershipId_dealer_id_status_idx"
  ON "ServiceAdvisor"("dealershipId", "dealer_id", "status");