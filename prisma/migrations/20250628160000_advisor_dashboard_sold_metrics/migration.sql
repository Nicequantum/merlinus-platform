-- Service advisor dashboard: login role link + sold metrics on repair lines
ALTER TYPE "TechnicianRole" ADD VALUE IF NOT EXISTS 'service_advisor';

ALTER TABLE "Technician" ADD COLUMN IF NOT EXISTS "serviceAdvisorId" TEXT;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "soldLaborHours" DOUBLE PRECISION;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "soldLaborAmount" DOUBLE PRECISION;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "soldPartsAmount" DOUBLE PRECISION;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "customerApproved" BOOLEAN;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "isAddOn" BOOLEAN;
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "soldMetricsUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Technician_serviceAdvisorId_idx" ON "Technician"("serviceAdvisorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Technician_serviceAdvisorId_fkey'
  ) THEN
    ALTER TABLE "Technician"
      ADD CONSTRAINT "Technician_serviceAdvisorId_fkey"
      FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;