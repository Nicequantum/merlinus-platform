-- Rename advisor profile column to reflect encrypted-at-rest storage.
ALTER TABLE "AdvisorWritingProfile" RENAME COLUMN "profileData" TO "profileDataEncrypted";