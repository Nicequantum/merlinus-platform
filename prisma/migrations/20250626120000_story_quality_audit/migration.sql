-- Persist MI audit results on repair lines so scores survive navigation and RO reload.
ALTER TABLE "RepairLine" ADD COLUMN "storyQualityAuditEncrypted" TEXT NOT NULL DEFAULT '';