-- Phase 5: drop dual-storage plaintext PII columns.
-- Prerequisite: npm run db:migrate-pii must report pendingAfterRun = 0 on all tables
-- before applying this migration in production.

DROP INDEX IF EXISTS "RepairOrder_roNumber_idx";

ALTER TABLE "RepairOrder" DROP COLUMN IF EXISTS "roNumber";
ALTER TABLE "RepairLine" DROP COLUMN IF EXISTS "description";
ALTER TABLE "ServiceAdvisor" DROP COLUMN IF EXISTS "displayName";