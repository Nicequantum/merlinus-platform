-- APEX NATIONAL PLATFORM — Phase 1: Dealer tenant model + dealer_id columns.
-- MERLINUS SINGLE-DEALER: backfills one default dealer for all existing Tiverton data.

CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Dealer_code_key" ON "Dealer"("code");
CREATE INDEX "Dealer_status_idx" ON "Dealer"("status");

INSERT INTO "Dealer" ("id", "code", "name", "status", "createdAt", "updatedAt")
VALUES (
    'merlinus-default-dealer',
    'merlinus-tiverton',
    'Merlinus Tiverton (Legacy Single-Dealer)',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

ALTER TABLE "Dealership" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "Technician" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "RepairOrder" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "RepairLine" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "ServiceAdvisor" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "AdvisorComplaintObservation" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "Template" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "TechnicianCertifiedStory" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "TechnicianActivityLog" ADD COLUMN "dealer_id" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN "dealer_id" TEXT;

UPDATE "Dealership" SET "dealer_id" = 'merlinus-default-dealer';

UPDATE "Technician" t
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE t."dealershipId" = d."id";

UPDATE "RepairOrder" ro
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE ro."dealershipId" = d."id";

UPDATE "RepairLine" rl
SET "dealer_id" = ro."dealer_id"
FROM "RepairOrder" ro
WHERE rl."repairOrderId" = ro."id";

UPDATE "ServiceAdvisor" sa
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE sa."dealershipId" = d."id";

UPDATE "AdvisorComplaintObservation" aco
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE aco."dealershipId" = d."id";

UPDATE "AuditLog" al
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE al."dealershipId" = d."id";

UPDATE "TechnicianCertifiedStory" tcs
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE tcs."dealershipId" = d."id";

UPDATE "TechnicianActivityLog" tal
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE tal."dealershipId" = d."id";

UPDATE "UsageLog" ul
SET "dealer_id" = d."dealer_id"
FROM "Dealership" d
WHERE ul."dealershipId" = d."id";

CREATE INDEX "Dealership_dealer_id_idx" ON "Dealership"("dealer_id");
CREATE INDEX "Technician_dealer_id_idx" ON "Technician"("dealer_id");
CREATE INDEX "RepairOrder_dealer_id_idx" ON "RepairOrder"("dealer_id");
CREATE INDEX "RepairOrder_dealer_id_dealershipId_idx" ON "RepairOrder"("dealer_id", "dealershipId");
CREATE INDEX "RepairLine_dealer_id_idx" ON "RepairLine"("dealer_id");
CREATE INDEX "ServiceAdvisor_dealer_id_idx" ON "ServiceAdvisor"("dealer_id");
CREATE INDEX "AdvisorComplaintObservation_dealer_id_idx" ON "AdvisorComplaintObservation"("dealer_id");
CREATE INDEX "Template_dealer_id_idx" ON "Template"("dealer_id");
CREATE INDEX "KnowledgeBase_dealer_id_idx" ON "KnowledgeBase"("dealer_id");
CREATE INDEX "AuditLog_dealer_id_idx" ON "AuditLog"("dealer_id");
CREATE INDEX "AuditLog_dealer_id_createdAt_idx" ON "AuditLog"("dealer_id", "createdAt");
CREATE INDEX "TechnicianCertifiedStory_dealer_id_idx" ON "TechnicianCertifiedStory"("dealer_id");
CREATE INDEX "TechnicianActivityLog_dealer_id_idx" ON "TechnicianActivityLog"("dealer_id");
CREATE INDEX "UsageLog_dealer_id_idx" ON "UsageLog"("dealer_id");

ALTER TABLE "Dealership" ADD CONSTRAINT "Dealership_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Technician" ADD CONSTRAINT "Technician_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RepairLine" ADD CONSTRAINT "RepairLine_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceAdvisor" ADD CONSTRAINT "ServiceAdvisor_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdvisorComplaintObservation" ADD CONSTRAINT "AdvisorComplaintObservation_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Template" ADD CONSTRAINT "Template_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TechnicianCertifiedStory" ADD CONSTRAINT "TechnicianCertifiedStory_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TechnicianActivityLog" ADD CONSTRAINT "TechnicianActivityLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;