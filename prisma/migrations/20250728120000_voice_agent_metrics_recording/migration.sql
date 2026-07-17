-- PR-M5b — voice call metrics + recording metadata (no story pipeline changes)

ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "recordingSid" TEXT;
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "recordingUrl" TEXT;
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "recordingStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "metricsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "contained" BOOLEAN;
ALTER TABLE "VoiceCall" ADD COLUMN IF NOT EXISTS "outcome" TEXT;

CREATE INDEX IF NOT EXISTS "VoiceCall_dealershipId_contained_idx"
  ON "VoiceCall"("dealershipId", "contained");
CREATE INDEX IF NOT EXISTS "VoiceCall_dealershipId_outcome_idx"
  ON "VoiceCall"("dealershipId", "outcome");
