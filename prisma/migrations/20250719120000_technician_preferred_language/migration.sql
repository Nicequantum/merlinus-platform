-- Phase 1 multilingual: technician preferred UI/voice language (en | es, extensible).
ALTER TABLE "Technician"
  ADD COLUMN IF NOT EXISTS "preferred_language" TEXT NOT NULL DEFAULT 'en';
