-- MFA fortress: UserMfa table + Technician backup-code column.
-- Idempotent-friendly for D1/SQLite (IF NOT EXISTS where supported).

CREATE TABLE IF NOT EXISTS "UserMfa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicianId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCodesEncrypted" TEXT,
    "enrolledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMfa_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMfa_technicianId_key" ON "UserMfa"("technicianId");
CREATE INDEX IF NOT EXISTS "UserMfa_enabled_idx" ON "UserMfa"("enabled");

-- Legacy/denormalized columns on Technician (safe if already present from schema push)
-- SQLite 3.35+ supports IF NOT EXISTS for columns on some builds; D1 uses ADD COLUMN once.
-- Re-run failures: ignore "duplicate column" at apply time when already migrated.

ALTER TABLE "Technician" ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Technician" ADD COLUMN "mfa_secret_encrypted" TEXT;
ALTER TABLE "Technician" ADD COLUMN "mfa_enrolled_at" DATETIME;
ALTER TABLE "Technician" ADD COLUMN "mfa_backup_codes_encrypted" TEXT;
