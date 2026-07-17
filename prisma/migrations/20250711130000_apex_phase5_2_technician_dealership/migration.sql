-- APEX NATIONAL PLATFORM — Phase 5.2: TechnicianDealership membership + backfill.
-- MERLINUS SINGLE-DEALER: one membership row per technician mirrors existing dealershipId.

CREATE TABLE IF NOT EXISTS "TechnicianDealership" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "role" "TechnicianRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianDealership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TechnicianDealership_technicianId_dealershipId_key"
  ON "TechnicianDealership"("technicianId", "dealershipId");

CREATE INDEX IF NOT EXISTS "TechnicianDealership_technicianId_idx"
  ON "TechnicianDealership"("technicianId");

CREATE INDEX IF NOT EXISTS "TechnicianDealership_dealershipId_idx"
  ON "TechnicianDealership"("dealershipId");

CREATE INDEX IF NOT EXISTS "TechnicianDealership_technicianId_isActive_idx"
  ON "TechnicianDealership"("technicianId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TechnicianDealership_technicianId_fkey'
  ) THEN
    ALTER TABLE "TechnicianDealership"
      ADD CONSTRAINT "TechnicianDealership_technicianId_fkey"
      FOREIGN KEY ("technicianId") REFERENCES "Technician"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TechnicianDealership_dealershipId_fkey'
  ) THEN
    ALTER TABLE "TechnicianDealership"
      ADD CONSTRAINT "TechnicianDealership_dealershipId_fkey"
      FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: one primary membership per existing technician (idempotent).
INSERT INTO "TechnicianDealership" (
    "id",
    "technicianId",
    "dealershipId",
    "role",
    "isPrimary",
    "isActive",
    "createdAt"
)
SELECT
    'tdb_' || t."id" || '_' || t."dealershipId",
    t."id",
    t."dealershipId",
    t."role",
    true,
    (t."isActive" = true AND t."deletedAt" IS NULL),
    COALESCE(t."createdAt", CURRENT_TIMESTAMP)
FROM "Technician" t
ON CONFLICT ("technicianId", "dealershipId") DO NOTHING;