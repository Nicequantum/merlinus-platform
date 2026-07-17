-- Persist technician story certification on RepairLine for non-repudiation across reloads.

ALTER TABLE "RepairLine"
  ADD COLUMN "storyCertifiedAt" TIMESTAMP(3),
  ADD COLUMN "storyCertifiedByTechnicianId" TEXT,
  ADD COLUMN "storyCertifiedByNameEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "storyCertifiedHash" TEXT NOT NULL DEFAULT '';

CREATE INDEX "RepairLine_storyCertifiedAt_idx" ON "RepairLine"("storyCertifiedAt");