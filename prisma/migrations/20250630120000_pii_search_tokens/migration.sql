-- Phase 3: blind-index tokens for encrypted RO number search (no plaintext query).
ALTER TABLE "RepairOrder" ADD COLUMN "roNumberSearchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "RepairOrder_roNumberSearchTokens_idx" ON "RepairOrder" USING GIN ("roNumberSearchTokens");