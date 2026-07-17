-- Usage monitoring: admin flag + per-technician API usage logs

ALTER TABLE "Technician" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Existing dealership managers can access the usage dashboard
UPDATE "Technician" SET "isAdmin" = true WHERE "role" = 'manager' AND "isAdmin" = false;

CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UsageLog_technicianId_createdAt_idx" ON "UsageLog"("technicianId", "createdAt");
CREATE INDEX "UsageLog_dealershipId_createdAt_idx" ON "UsageLog"("dealershipId", "createdAt");

ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;