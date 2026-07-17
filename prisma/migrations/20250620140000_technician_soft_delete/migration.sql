-- AlterTable
ALTER TABLE "Technician" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Technician_deletedAt_idx" ON "Technician"("deletedAt");