-- AlterTable
ALTER TABLE "Technician" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "previousHash" TEXT NOT NULL DEFAULT 'GENESIS';
ALTER TABLE "AuditLog" ADD COLUMN "entryHash" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_createdAt_idx" ON "AuditLog"("dealershipId", "createdAt");