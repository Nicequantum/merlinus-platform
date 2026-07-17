-- Rename plaintext sensitive columns to encrypted column names.
-- Existing data remains readable via legacy-plaintext fallback in roMapper until re-saved.

ALTER TABLE "RepairOrder" RENAME COLUMN "xentryOcrTexts" TO "xentryOcrTextsEncrypted";
ALTER TABLE "RepairLine" RENAME COLUMN "technicianNotes" TO "technicianNotesEncrypted";
ALTER TABLE "RepairLine" RENAME COLUMN "xentryOcrTexts" TO "xentryOcrTextsEncrypted";
ALTER TABLE "RepairLine" RENAME COLUMN "warrantyStory" TO "warrantyStoryEncrypted";