-- =============================================================================
-- PR-M3 — Maintenance tickets (photos, events) + maintenance TechnicianRole
-- Does not touch RepairOrder / RepairLine / DepartmentRequest / VideoInspection.
-- =============================================================================

DO $$ BEGIN
  ALTER TYPE "TechnicianRole" ADD VALUE 'maintenance';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaintenanceSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaintenanceTicketStatus" AS ENUM (
    'submitted', 'triage', 'scheduled', 'in_progress', 'blocked', 'done', 'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MaintenanceTicket" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "department" TEXT NOT NULL DEFAULT 'facilities',
    "title" TEXT NOT NULL,
    "descriptionEncrypted" TEXT NOT NULL DEFAULT '',
    "severity" "MaintenanceSeverity" NOT NULL DEFAULT 'medium',
    "status" "MaintenanceTicketStatus" NOT NULL DEFAULT 'submitted',
    "locationLabel" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MaintenancePhoto" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenancePhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MaintenanceTicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceTicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaintenanceTicket_dealershipId_status_severity_idx"
  ON "MaintenanceTicket"("dealershipId", "status", "severity");
CREATE INDEX IF NOT EXISTS "MaintenanceTicket_dealershipId_createdAt_idx"
  ON "MaintenanceTicket"("dealershipId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "MaintenanceTicket_assignedToId_status_idx"
  ON "MaintenanceTicket"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "MaintenanceTicket_dealer_id_idx"
  ON "MaintenanceTicket"("dealer_id");

CREATE INDEX IF NOT EXISTS "MaintenancePhoto_ticketId_createdAt_idx"
  ON "MaintenancePhoto"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "MaintenanceTicketEvent_ticketId_createdAt_idx"
  ON "MaintenanceTicketEvent"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "MaintenanceTicketEvent_actorId_idx"
  ON "MaintenanceTicketEvent"("actorId");

ALTER TABLE "MaintenanceTicket" DROP CONSTRAINT IF EXISTS "MaintenanceTicket_dealershipId_fkey";
ALTER TABLE "MaintenanceTicket"
  ADD CONSTRAINT "MaintenanceTicket_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicket" DROP CONSTRAINT IF EXISTS "MaintenanceTicket_createdById_fkey";
ALTER TABLE "MaintenanceTicket"
  ADD CONSTRAINT "MaintenanceTicket_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicket" DROP CONSTRAINT IF EXISTS "MaintenanceTicket_assignedToId_fkey";
ALTER TABLE "MaintenanceTicket"
  ADD CONSTRAINT "MaintenanceTicket_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenancePhoto" DROP CONSTRAINT IF EXISTS "MaintenancePhoto_ticketId_fkey";
ALTER TABLE "MaintenancePhoto"
  ADD CONSTRAINT "MaintenancePhoto_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicketEvent" DROP CONSTRAINT IF EXISTS "MaintenanceTicketEvent_ticketId_fkey";
ALTER TABLE "MaintenanceTicketEvent"
  ADD CONSTRAINT "MaintenanceTicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaintenanceTicketEvent" DROP CONSTRAINT IF EXISTS "MaintenanceTicketEvent_actorId_fkey";
ALTER TABLE "MaintenanceTicketEvent"
  ADD CONSTRAINT "MaintenanceTicketEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "MaintenanceTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceTicket" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_ticket_tenant_all ON "MaintenanceTicket";
CREATE POLICY maintenance_ticket_tenant_all ON "MaintenanceTicket"
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

ALTER TABLE "MaintenancePhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenancePhoto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_photo_tenant_all ON "MaintenancePhoto";
CREATE POLICY maintenance_photo_tenant_all ON "MaintenancePhoto"
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
        SELECT 1 FROM "MaintenanceTicket" t
        WHERE t."id" = "MaintenancePhoto"."ticketId"
          AND t."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "MaintenanceTicket" t
        WHERE t."id" = "MaintenancePhoto"."ticketId"
          AND t."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

ALTER TABLE "MaintenanceTicketEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceTicketEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_ticket_event_tenant_all ON "MaintenanceTicketEvent";
CREATE POLICY maintenance_ticket_event_tenant_all ON "MaintenanceTicketEvent"
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
        SELECT 1 FROM "MaintenanceTicket" t
        WHERE t."id" = "MaintenanceTicketEvent"."ticketId"
          AND t."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "MaintenanceTicket" t
        WHERE t."id" = "MaintenanceTicketEvent"."ticketId"
          AND t."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );
