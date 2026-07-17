-- =============================================================================
-- PR-M4 — Loaner fleet (vehicles + assignments) + loaner TechnicianRole
-- Does not touch RepairOrder, VideoInspection, DepartmentRequest, MaintenanceTicket.
-- =============================================================================

DO $$ BEGIN
  ALTER TYPE "TechnicianRole" ADD VALUE 'loaner';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LoanerVehicleStatus" AS ENUM (
    'available', 'reserved', 'out', 'maintenance', 'out_of_service'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LoanerAssignmentStatus" AS ENUM (
    'reserved', 'active', 'returned', 'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "LoanerVehicle" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "unitNumber" TEXT NOT NULL,
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "vinLast8" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "plateEncrypted" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "status" "LoanerVehicleStatus" NOT NULL DEFAULT 'available',
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanerVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoanerAssignment" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "loanerVehicleId" TEXT NOT NULL,
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "repairOrderId" TEXT,
    "departmentRequestId" TEXT,
    "checkoutAt" TIMESTAMP(3),
    "dueBackAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "outOdometer" INTEGER,
    "inOdometer" INTEGER,
    "fuelOut" TEXT,
    "fuelIn" TEXT,
    "damageOutJson" TEXT NOT NULL DEFAULT '[]',
    "damageInJson" TEXT NOT NULL DEFAULT '[]',
    "status" "LoanerAssignmentStatus" NOT NULL DEFAULT 'reserved',
    "createdById" TEXT,
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanerAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoanerVehicle_dealershipId_unitNumber_key"
  ON "LoanerVehicle"("dealershipId", "unitNumber");
CREATE INDEX IF NOT EXISTS "LoanerVehicle_dealershipId_status_idx"
  ON "LoanerVehicle"("dealershipId", "status");
CREATE INDEX IF NOT EXISTS "LoanerVehicle_dealershipId_vinLast8_idx"
  ON "LoanerVehicle"("dealershipId", "vinLast8");
CREATE INDEX IF NOT EXISTS "LoanerVehicle_dealer_id_idx"
  ON "LoanerVehicle"("dealer_id");

CREATE INDEX IF NOT EXISTS "LoanerAssignment_dealershipId_status_createdAt_idx"
  ON "LoanerAssignment"("dealershipId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LoanerAssignment_loanerVehicleId_status_idx"
  ON "LoanerAssignment"("loanerVehicleId", "status");
CREATE INDEX IF NOT EXISTS "LoanerAssignment_dealershipId_customerPhoneLast4_idx"
  ON "LoanerAssignment"("dealershipId", "customerPhoneLast4");
CREATE INDEX IF NOT EXISTS "LoanerAssignment_dealer_id_idx"
  ON "LoanerAssignment"("dealer_id");

ALTER TABLE "LoanerVehicle" DROP CONSTRAINT IF EXISTS "LoanerVehicle_dealershipId_fkey";
ALTER TABLE "LoanerVehicle"
  ADD CONSTRAINT "LoanerVehicle_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanerAssignment" DROP CONSTRAINT IF EXISTS "LoanerAssignment_dealershipId_fkey";
ALTER TABLE "LoanerAssignment"
  ADD CONSTRAINT "LoanerAssignment_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanerAssignment" DROP CONSTRAINT IF EXISTS "LoanerAssignment_loanerVehicleId_fkey";
ALTER TABLE "LoanerAssignment"
  ADD CONSTRAINT "LoanerAssignment_loanerVehicleId_fkey"
  FOREIGN KEY ("loanerVehicleId") REFERENCES "LoanerVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanerAssignment" DROP CONSTRAINT IF EXISTS "LoanerAssignment_createdById_fkey";
ALTER TABLE "LoanerAssignment"
  ADD CONSTRAINT "LoanerAssignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "LoanerVehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoanerVehicle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loaner_vehicle_tenant_all ON "LoanerVehicle";
CREATE POLICY loaner_vehicle_tenant_all ON "LoanerVehicle"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

ALTER TABLE "LoanerAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoanerAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loaner_assignment_tenant_all ON "LoanerAssignment";
CREATE POLICY loaner_assignment_tenant_all ON "LoanerAssignment"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );
