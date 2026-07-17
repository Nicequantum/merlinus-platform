-- Service Advisor management: soft delete, CSI, createdAt
ALTER TABLE "ServiceAdvisor" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ServiceAdvisor" ADD COLUMN IF NOT EXISTS "csiScore" DOUBLE PRECISION;
ALTER TABLE "ServiceAdvisor" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ServiceAdvisor_dealershipId_status_idx" ON "ServiceAdvisor"("dealershipId", "status");
CREATE INDEX IF NOT EXISTS "ServiceAdvisor_dealershipId_deletedAt_idx" ON "ServiceAdvisor"("dealershipId", "deletedAt");