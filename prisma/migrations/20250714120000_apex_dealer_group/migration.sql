-- APEX PR-G1: DealerGroup portfolio + membership (multi-brand ownership)

CREATE TABLE IF NOT EXISTS "DealerGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealerGroup_code_key" ON "DealerGroup"("code");
CREATE INDEX IF NOT EXISTS "DealerGroup_status_idx" ON "DealerGroup"("status");

CREATE TABLE IF NOT EXISTS "DealerGroupMembership" (
    "id" TEXT NOT NULL,
    "dealer_group_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealerGroupMembership_dealer_group_id_technician_id_key"
  ON "DealerGroupMembership"("dealer_group_id", "technician_id");
CREATE INDEX IF NOT EXISTS "DealerGroupMembership_technician_id_is_active_idx"
  ON "DealerGroupMembership"("technician_id", "is_active");
CREATE INDEX IF NOT EXISTS "DealerGroupMembership_dealer_group_id_idx"
  ON "DealerGroupMembership"("dealer_group_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DealerGroupMembership_dealer_group_id_fkey'
  ) THEN
    ALTER TABLE "DealerGroupMembership"
      ADD CONSTRAINT "DealerGroupMembership_dealer_group_id_fkey"
      FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DealerGroupMembership_technician_id_fkey'
  ) THEN
    ALTER TABLE "DealerGroupMembership"
      ADD CONSTRAINT "DealerGroupMembership_technician_id_fkey"
      FOREIGN KEY ("technician_id") REFERENCES "Technician"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Dealer"
  ADD COLUMN IF NOT EXISTS "dealer_group_id" TEXT;

CREATE INDEX IF NOT EXISTS "Dealer_dealer_group_id_idx" ON "Dealer"("dealer_group_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Dealer_dealer_group_id_fkey'
  ) THEN
    ALTER TABLE "Dealer"
      ADD CONSTRAINT "Dealer_dealer_group_id_fkey"
      FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
