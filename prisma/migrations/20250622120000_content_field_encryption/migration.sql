-- Rename plaintext content columns to encrypted column names.
-- Run `npm run db:reencrypt` after deploy to encrypt existing plaintext values.

ALTER TABLE "RepairLine" RENAME COLUMN "extractedData" TO "extractedDataEncrypted";
ALTER TABLE "Template" RENAME COLUMN "content" TO "contentEncrypted";
ALTER TABLE "KnowledgeBase" RENAME COLUMN "generatedText" TO "generatedTextEncrypted";
ALTER TABLE "KnowledgeBase" RENAME COLUMN "fullOriginalText" TO "fullOriginalTextEncrypted";
ALTER TABLE "KnowledgeBase" RENAME COLUMN "cleanTemplate" TO "cleanTemplateEncrypted";