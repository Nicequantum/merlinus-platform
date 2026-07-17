-- Technician onboarding fields (consent + disclaimer + first launch)
ALTER TABLE "Technician" ADD COLUMN "legalDisclaimerAt" TIMESTAMP(3);
ALTER TABLE "Technician" ADD COLUMN "legalDisclaimerVersion" TEXT;
ALTER TABLE "Technician" ADD COLUMN "firstAppLaunchAt" TIMESTAMP(3);
ALTER TABLE "Technician" ADD COLUMN "firstAppLaunchSessionId" TEXT;

-- Certified warranty stories per technician
CREATE TABLE "TechnicianCertifiedStory" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "repairLineId" TEXT NOT NULL,
    "roNumber" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "certifiedAt" TIMESTAMP(3) NOT NULL,
    "certifiedByName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'legacy',
    "auditLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianCertifiedStory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TechnicianCertifiedStory_technicianId_certifiedAt_idx" ON "TechnicianCertifiedStory"("technicianId", "certifiedAt" DESC);
CREATE INDEX "TechnicianCertifiedStory_dealershipId_certifiedAt_idx" ON "TechnicianCertifiedStory"("dealershipId", "certifiedAt" DESC);
CREATE INDEX "TechnicianCertifiedStory_repairOrderId_idx" ON "TechnicianCertifiedStory"("repairOrderId");
CREATE INDEX "TechnicianCertifiedStory_repairLineId_idx" ON "TechnicianCertifiedStory"("repairLineId");

ALTER TABLE "TechnicianCertifiedStory" ADD CONSTRAINT "TechnicianCertifiedStory_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;