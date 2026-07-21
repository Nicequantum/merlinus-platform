-- P3-4 Password recovery tokens (D1 / SQLite)
CREATE TABLE IF NOT EXISTS "PasswordRecoveryToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "technicianId" TEXT NOT NULL,
  "dealershipId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordRecoveryToken_dealershipId_fkey"
    FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordRecoveryToken_tokenHash_key"
  ON "PasswordRecoveryToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_technicianId_createdAt_idx"
  ON "PasswordRecoveryToken"("technicianId", "createdAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_dealershipId_createdAt_idx"
  ON "PasswordRecoveryToken"("dealershipId", "createdAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryToken_expiresAt_idx"
  ON "PasswordRecoveryToken"("expiresAt");
