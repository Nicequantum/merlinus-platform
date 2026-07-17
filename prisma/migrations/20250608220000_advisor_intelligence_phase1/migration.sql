-- Advisor Intelligence Phase 1: service advisors, observations, writing profiles

CREATE TABLE "ServiceAdvisor" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "nameFingerprint" TEXT NOT NULL,
    "advisorCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mergedIntoId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceAdvisor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceAdvisorAlias" (
    "id" TEXT NOT NULL,
    "serviceAdvisorId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "aliasFingerprint" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAdvisorAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvisorComplaintObservation" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "serviceAdvisorId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "lineLabel" TEXT,
    "complaintTextEncrypted" TEXT NOT NULL,
    "extractionSource" TEXT NOT NULL,
    "extractionConfidence" DOUBLE PRECISION,
    "wasCorrected" BOOLEAN NOT NULL DEFAULT false,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "vehicleFamily" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorComplaintObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvisorWritingProfile" (
    "id" TEXT NOT NULL,
    "serviceAdvisorId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL DEFAULT 1,
    "profileData" TEXT NOT NULL DEFAULT '{}',
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorWritingProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RepairOrder" ADD COLUMN "serviceAdvisorId" TEXT;
ALTER TABLE "RepairOrder" ADD COLUMN "serviceAdvisorNameEncrypted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RepairOrder" ADD COLUMN "advisorMatchConfidence" DOUBLE PRECISION;
ALTER TABLE "RepairOrder" ADD COLUMN "advisorIdentifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ServiceAdvisor_dealershipId_nameFingerprint_key" ON "ServiceAdvisor"("dealershipId", "nameFingerprint");
CREATE INDEX "ServiceAdvisor_dealershipId_lastSeenAt_idx" ON "ServiceAdvisor"("dealershipId", "lastSeenAt");

CREATE UNIQUE INDEX "ServiceAdvisorAlias_serviceAdvisorId_aliasFingerprint_key" ON "ServiceAdvisorAlias"("serviceAdvisorId", "aliasFingerprint");
CREATE INDEX "ServiceAdvisorAlias_aliasFingerprint_idx" ON "ServiceAdvisorAlias"("aliasFingerprint");

CREATE INDEX "AdvisorComplaintObservation_serviceAdvisorId_observedAt_idx" ON "AdvisorComplaintObservation"("serviceAdvisorId", "observedAt");
CREATE INDEX "AdvisorComplaintObservation_repairOrderId_idx" ON "AdvisorComplaintObservation"("repairOrderId");
CREATE INDEX "AdvisorComplaintObservation_dealershipId_observedAt_idx" ON "AdvisorComplaintObservation"("dealershipId", "observedAt");

CREATE UNIQUE INDEX "AdvisorWritingProfile_serviceAdvisorId_key" ON "AdvisorWritingProfile"("serviceAdvisorId");

CREATE INDEX "RepairOrder_serviceAdvisorId_idx" ON "RepairOrder"("serviceAdvisorId");

ALTER TABLE "ServiceAdvisor" ADD CONSTRAINT "ServiceAdvisor_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceAdvisorAlias" ADD CONSTRAINT "ServiceAdvisorAlias_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdvisorComplaintObservation" ADD CONSTRAINT "AdvisorComplaintObservation_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvisorComplaintObservation" ADD CONSTRAINT "AdvisorComplaintObservation_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvisorComplaintObservation" ADD CONSTRAINT "AdvisorComplaintObservation_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdvisorWritingProfile" ADD CONSTRAINT "AdvisorWritingProfile_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor"("id") ON DELETE SET NULL ON UPDATE CASCADE;