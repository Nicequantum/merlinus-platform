-- MFA fortress: UserMfa table + Technician backup-code column (v4.1.0)
-- Prisma twin: prisma/migrations/20250721180000_user_mfa_totp

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

-- mfa_enabled / mfa_secret_encrypted / mfa_enrolled_at already applied via 20250721140000_ai_job_and_mfa
ALTER TABLE "Technician" ADD COLUMN "mfa_backup_codes_encrypted" TEXT;
