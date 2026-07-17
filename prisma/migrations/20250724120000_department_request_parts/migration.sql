-- =============================================================================
-- PR-M2 — DepartmentRequest spine + Parts lines/lookups + parts TechnicianRole
-- Does not touch RepairOrder / RepairLine / story pipeline tables.
-- =============================================================================

-- Extend role enum (safe if re-run)
DO $$ BEGIN
  ALTER TYPE "TechnicianRole" ADD VALUE 'parts';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DepartmentRequest" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "department" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "summaryEncrypted" TEXT NOT NULL DEFAULT '',
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "customerEmailEncrypted" TEXT NOT NULL DEFAULT '',
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "vinLast8" TEXT,
    "vehicleLabel" TEXT,
    "stockOrRoHint" TEXT,
    "voiceCallId" TEXT,
    "createdById" TEXT,
    "assignedToId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartsRequestLine" (
    "id" TEXT NOT NULL,
    "departmentRequestId" TEXT NOT NULL,
    "partNumber" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "quotedPriceCents" INTEGER,
    "vendor" TEXT,
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartsRequestLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartsLookupEvent" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "departmentRequestId" TEXT,
    "query" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartsLookupEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DepartmentRequest_dealershipId_department_status_createdAt_idx"
  ON "DepartmentRequest"("dealershipId", "department", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "DepartmentRequest_dealershipId_vinLast8_idx"
  ON "DepartmentRequest"("dealershipId", "vinLast8");
CREATE INDEX IF NOT EXISTS "DepartmentRequest_dealershipId_customerPhoneLast4_idx"
  ON "DepartmentRequest"("dealershipId", "customerPhoneLast4");
CREATE INDEX IF NOT EXISTS "DepartmentRequest_assignedToId_status_idx"
  ON "DepartmentRequest"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "DepartmentRequest_dealer_id_idx"
  ON "DepartmentRequest"("dealer_id");

CREATE INDEX IF NOT EXISTS "PartsRequestLine_departmentRequestId_sortOrder_idx"
  ON "PartsRequestLine"("departmentRequestId", "sortOrder");
CREATE INDEX IF NOT EXISTS "PartsRequestLine_departmentRequestId_status_idx"
  ON "PartsRequestLine"("departmentRequestId", "status");

CREATE INDEX IF NOT EXISTS "PartsLookupEvent_dealershipId_createdAt_idx"
  ON "PartsLookupEvent"("dealershipId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PartsLookupEvent_departmentRequestId_createdAt_idx"
  ON "PartsLookupEvent"("departmentRequestId", "createdAt" DESC);

ALTER TABLE "DepartmentRequest" DROP CONSTRAINT IF EXISTS "DepartmentRequest_dealershipId_fkey";
ALTER TABLE "DepartmentRequest"
  ADD CONSTRAINT "DepartmentRequest_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DepartmentRequest" DROP CONSTRAINT IF EXISTS "DepartmentRequest_dealer_id_fkey";
ALTER TABLE "DepartmentRequest"
  ADD CONSTRAINT "DepartmentRequest_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DepartmentRequest" DROP CONSTRAINT IF EXISTS "DepartmentRequest_createdById_fkey";
ALTER TABLE "DepartmentRequest"
  ADD CONSTRAINT "DepartmentRequest_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DepartmentRequest" DROP CONSTRAINT IF EXISTS "DepartmentRequest_assignedToId_fkey";
ALTER TABLE "DepartmentRequest"
  ADD CONSTRAINT "DepartmentRequest_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartsRequestLine" DROP CONSTRAINT IF EXISTS "PartsRequestLine_departmentRequestId_fkey";
ALTER TABLE "PartsRequestLine"
  ADD CONSTRAINT "PartsRequestLine_departmentRequestId_fkey"
  FOREIGN KEY ("departmentRequestId") REFERENCES "DepartmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartsLookupEvent" DROP CONSTRAINT IF EXISTS "PartsLookupEvent_departmentRequestId_fkey";
ALTER TABLE "PartsLookupEvent"
  ADD CONSTRAINT "PartsLookupEvent_departmentRequestId_fkey"
  FOREIGN KEY ("departmentRequestId") REFERENCES "DepartmentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartsLookupEvent" DROP CONSTRAINT IF EXISTS "PartsLookupEvent_createdById_fkey";
ALTER TABLE "PartsLookupEvent"
  ADD CONSTRAINT "PartsLookupEvent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "DepartmentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_request_tenant_all ON "DepartmentRequest";
CREATE POLICY department_request_tenant_all ON "DepartmentRequest"
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

ALTER TABLE "PartsRequestLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartsRequestLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parts_request_line_tenant_all ON "PartsRequestLine";
CREATE POLICY parts_request_line_tenant_all ON "PartsRequestLine"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND EXISTS (
        SELECT 1 FROM "DepartmentRequest" dr
        WHERE dr."id" = "PartsRequestLine"."departmentRequestId"
          AND dr."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
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
      AND EXISTS (
        SELECT 1 FROM "DepartmentRequest" dr
        WHERE dr."id" = "PartsRequestLine"."departmentRequestId"
          AND dr."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

ALTER TABLE "PartsLookupEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartsLookupEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parts_lookup_event_tenant_all ON "PartsLookupEvent";
CREATE POLICY parts_lookup_event_tenant_all ON "PartsLookupEvent"
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
