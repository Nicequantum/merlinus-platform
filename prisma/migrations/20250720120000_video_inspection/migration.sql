-- Video Inspection & AI customer report (separate from warranty story pipeline).

CREATE TABLE IF NOT EXISTS "VideoInspection" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "repairLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "videoPathname" TEXT NOT NULL DEFAULT '',
    "contentType" TEXT NOT NULL DEFAULT 'video/webm',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "durationSec" DOUBLE PRECISION,
    "thumbnailPathname" TEXT,
    "framePathnames" TEXT NOT NULL DEFAULT '[]',
    "transcriptEncrypted" TEXT NOT NULL DEFAULT '',
    "transcriptLanguage" TEXT NOT NULL DEFAULT 'en',
    "reportEncrypted" TEXT NOT NULL DEFAULT '',
    "reportPromptVersion" TEXT NOT NULL DEFAULT '',
    "vehicleLabel" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Video inspection',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VideoInspectionShare" (
    "id" TEXT NOT NULL,
    "videoInspectionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passcodeHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdByTechnicianId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspectionShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VideoInspectionSmsLog" (
    "id" TEXT NOT NULL,
    "videoInspectionId" TEXT NOT NULL,
    "shareId" TEXT,
    "phoneEncrypted" TEXT NOT NULL DEFAULT '',
    "phoneLast4" TEXT NOT NULL DEFAULT '',
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sentByTechnicianId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspectionSmsLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VideoInspection_dealershipId_createdAt_idx" ON "VideoInspection"("dealershipId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "VideoInspection_technicianId_createdAt_idx" ON "VideoInspection"("technicianId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "VideoInspection_dealershipId_status_idx" ON "VideoInspection"("dealershipId", "status");
CREATE INDEX IF NOT EXISTS "VideoInspection_dealer_id_idx" ON "VideoInspection"("dealer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "VideoInspectionShare_tokenHash_key" ON "VideoInspectionShare"("tokenHash");
CREATE INDEX IF NOT EXISTS "VideoInspectionShare_videoInspectionId_idx" ON "VideoInspectionShare"("videoInspectionId");
CREATE INDEX IF NOT EXISTS "VideoInspectionShare_createdByTechnicianId_idx" ON "VideoInspectionShare"("createdByTechnicianId");

CREATE INDEX IF NOT EXISTS "VideoInspectionSmsLog_videoInspectionId_createdAt_idx" ON "VideoInspectionSmsLog"("videoInspectionId", "createdAt");
CREATE INDEX IF NOT EXISTS "VideoInspectionSmsLog_sentByTechnicianId_idx" ON "VideoInspectionSmsLog"("sentByTechnicianId");

ALTER TABLE "VideoInspection" DROP CONSTRAINT IF EXISTS "VideoInspection_dealershipId_fkey";
ALTER TABLE "VideoInspection" ADD CONSTRAINT "VideoInspection_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoInspection" DROP CONSTRAINT IF EXISTS "VideoInspection_technicianId_fkey";
ALTER TABLE "VideoInspection" ADD CONSTRAINT "VideoInspection_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoInspectionShare" DROP CONSTRAINT IF EXISTS "VideoInspectionShare_videoInspectionId_fkey";
ALTER TABLE "VideoInspectionShare" ADD CONSTRAINT "VideoInspectionShare_videoInspectionId_fkey" FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoInspectionShare" DROP CONSTRAINT IF EXISTS "VideoInspectionShare_createdByTechnicianId_fkey";
ALTER TABLE "VideoInspectionShare" ADD CONSTRAINT "VideoInspectionShare_createdByTechnicianId_fkey" FOREIGN KEY ("createdByTechnicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoInspectionSmsLog" DROP CONSTRAINT IF EXISTS "VideoInspectionSmsLog_videoInspectionId_fkey";
ALTER TABLE "VideoInspectionSmsLog" ADD CONSTRAINT "VideoInspectionSmsLog_videoInspectionId_fkey" FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoInspectionSmsLog" DROP CONSTRAINT IF EXISTS "VideoInspectionSmsLog_sentByTechnicianId_fkey";
ALTER TABLE "VideoInspectionSmsLog" ADD CONSTRAINT "VideoInspectionSmsLog_sentByTechnicianId_fkey" FOREIGN KEY ("sentByTechnicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;
