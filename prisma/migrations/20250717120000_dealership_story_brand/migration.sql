-- Multi-brand warranty story packs (mercedes | generic | future OEM ids)
ALTER TABLE "Dealership" ADD COLUMN IF NOT EXISTS "story_brand" TEXT NOT NULL DEFAULT 'mercedes';

-- Apex pilot rooftops used for side-by-side story testing
UPDATE "Dealership" SET "story_brand" = 'mercedes' WHERE id = 'seed-dealership';
UPDATE "Dealership" SET "story_brand" = 'generic' WHERE id = 'seed-dealership-2';
