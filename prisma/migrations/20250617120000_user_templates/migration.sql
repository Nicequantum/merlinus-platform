-- AlterTable Template: support per-dealership user-saved templates
ALTER TABLE "Template" DROP CONSTRAINT IF EXISTS "Template_title_key";
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "dealershipId" TEXT NOT NULL DEFAULT '__global__';
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "useCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "Template_dealershipId_title_key" ON "Template"("dealershipId", "title");
CREATE INDEX IF NOT EXISTS "Template_dealershipId_lastUsedAt_idx" ON "Template"("dealershipId", "lastUsedAt");
CREATE INDEX IF NOT EXISTS "Template_source_idx" ON "Template"("source");

-- AlterTable KnowledgeBase: store Grok draft + final approved text
ALTER TABLE "KnowledgeBase" DROP CONSTRAINT IF EXISTS "KnowledgeBase_title_key";
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "generatedText" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "dealershipId" TEXT NOT NULL DEFAULT '__global__';
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_dealershipId_title_key" ON "KnowledgeBase"("dealershipId", "title");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_dealershipId_idx" ON "KnowledgeBase"("dealershipId");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_source_idx" ON "KnowledgeBase"("source");