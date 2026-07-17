-- Billing: first AI story generation per repair line (idempotent).

-- AlterTable
ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "story_generated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "usage_events" (
    "id" TEXT NOT NULL,
    "dealership_id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "ro_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RepairLine_story_generated_idx" ON "RepairLine"("story_generated");

CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_line_id_event_type_key" ON "usage_events"("line_id", "event_type");

CREATE INDEX IF NOT EXISTS "usage_events_dealership_id_created_at_idx" ON "usage_events"("dealership_id", "created_at");

CREATE INDEX IF NOT EXISTS "usage_events_dealership_id_event_type_created_at_idx" ON "usage_events"("dealership_id", "event_type", "created_at");

CREATE INDEX IF NOT EXISTS "usage_events_ro_id_idx" ON "usage_events"("ro_id");

CREATE INDEX IF NOT EXISTS "usage_events_line_id_idx" ON "usage_events"("line_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_dealership_id_fkey'
  ) THEN
    ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_dealership_id_fkey"
      FOREIGN KEY ("dealership_id") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_dealer_id_fkey'
  ) THEN
    ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_dealer_id_fkey"
      FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_ro_id_fkey'
  ) THEN
    ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_ro_id_fkey"
      FOREIGN KEY ("ro_id") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_line_id_fkey'
  ) THEN
    ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_line_id_fkey"
      FOREIGN KEY ("line_id") REFERENCES "RepairLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
