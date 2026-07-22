-- Platform encryption key rotation progress tracking.

CREATE TABLE IF NOT EXISTS "EncryptionRotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending_env',
    "primaryFingerprint" TEXT NOT NULL DEFAULT '',
    "previousFingerprint" TEXT NOT NULL DEFAULT '',
    "targetFingerprint" TEXT NOT NULL DEFAULT '',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "updatedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "currentTable" TEXT NOT NULL DEFAULT '',
    "cursorId" TEXT NOT NULL DEFAULT '',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedByTechnicianId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "EncryptionRotation_status_createdAt_idx"
  ON "EncryptionRotation"("status", "createdAt");
