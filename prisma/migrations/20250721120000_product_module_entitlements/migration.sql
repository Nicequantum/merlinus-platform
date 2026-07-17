-- =============================================================================
-- PR-M0 — Product module entitlements (DealershipModule + DealerGroupModule)
-- Toggleable modules per rooftop / dealer group. core_story is NOT a ModuleId
-- (RO story pipeline remains always-on outside this table).
-- =============================================================================

CREATE TYPE "ModuleId" AS ENUM (
  'video_mpi',
  'maintenance',
  'voice_agent',
  'loaner',
  'parts',
  'cdk_sync'
);

CREATE TABLE IF NOT EXISTS "DealershipModule" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "moduleId" "ModuleId" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "enabledAt" TIMESTAMP(3),
    "enabledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealershipModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DealerGroupModule" (
    "id" TEXT NOT NULL,
    "dealer_group_id" TEXT NOT NULL,
    "module_id" "ModuleId" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerGroupModule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealershipModule_dealershipId_moduleId_key"
  ON "DealershipModule"("dealershipId", "moduleId");
CREATE INDEX IF NOT EXISTS "DealershipModule_dealershipId_enabled_idx"
  ON "DealershipModule"("dealershipId", "enabled");
CREATE INDEX IF NOT EXISTS "DealershipModule_moduleId_enabled_idx"
  ON "DealershipModule"("moduleId", "enabled");

CREATE UNIQUE INDEX IF NOT EXISTS "DealerGroupModule_dealer_group_id_module_id_key"
  ON "DealerGroupModule"("dealer_group_id", "module_id");
CREATE INDEX IF NOT EXISTS "DealerGroupModule_dealer_group_id_enabled_idx"
  ON "DealerGroupModule"("dealer_group_id", "enabled");
CREATE INDEX IF NOT EXISTS "DealerGroupModule_module_id_enabled_idx"
  ON "DealerGroupModule"("module_id", "enabled");

ALTER TABLE "DealershipModule" DROP CONSTRAINT IF EXISTS "DealershipModule_dealershipId_fkey";
ALTER TABLE "DealershipModule"
  ADD CONSTRAINT "DealershipModule_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerGroupModule" DROP CONSTRAINT IF EXISTS "DealerGroupModule_dealer_group_id_fkey";
ALTER TABLE "DealerGroupModule"
  ADD CONSTRAINT "DealerGroupModule_dealer_group_id_fkey"
  FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS: DealershipModule (dealership-scoped, Phase 6.2 default-deny soft-open) ─
ALTER TABLE "DealershipModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealershipModule" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dealership_module_tenant_all ON "DealershipModule";
CREATE POLICY dealership_module_tenant_all ON "DealershipModule"
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
    OR current_setting('app.scope_mode', true) = 'national'
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
    OR current_setting('app.scope_mode', true) = 'national'
  );

-- ─── RLS: DealerGroupModule (group portfolio / national / bypass) ────────────
ALTER TABLE "DealerGroupModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealerGroupModule" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dealer_group_module_all ON "DealerGroupModule";
CREATE POLICY dealer_group_module_all ON "DealerGroupModule"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR current_setting('app.scope_mode', true) = 'national'
    OR EXISTS (
      SELECT 1
      FROM "DealerGroupMembership" m
      WHERE m."dealer_group_id" = "DealerGroupModule"."dealer_group_id"
        AND m."technician_id" = NULLIF(current_setting('app.technician_id', true), '')
        AND m."is_active" = true
    )
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR current_setting('app.scope_mode', true) = 'national'
    OR EXISTS (
      SELECT 1
      FROM "DealerGroupMembership" m
      WHERE m."dealer_group_id" = "DealerGroupModule"."dealer_group_id"
        AND m."technician_id" = NULLIF(current_setting('app.technician_id', true), '')
        AND m."is_active" = true
    )
  );
