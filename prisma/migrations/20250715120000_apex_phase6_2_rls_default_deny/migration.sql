-- =============================================================================
-- APEX NATIONAL PLATFORM — Phase 6.2 RLS default-deny + Technician / UsageLog
-- =============================================================================
-- Soft-open is NO LONGER the default when app.rls_enforced is off.
-- Soft-open requires explicit app.rls_soft_open = 'on' (Merlinus only).
-- Apex always sets enforced=on + soft_open=off → default deny without tenant match/bypass.
--
-- New session variable:
--   app.rls_soft_open   'on' = Merlinus gradual soft-open (never set for Apex)
--
-- Soft-open predicate (replaces former "enforced <> on"):
--   soft_open = 'on' AND enforced <> 'on'
-- =============================================================================

-- Helper: re-apply tenant policies with default-deny soft-open on existing tables.
-- Predicate fragment used in every policy:
--   (soft_open) OR bypass OR (tenant match...)

-- ─── RepairOrder ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS repair_order_tenant_all ON "RepairOrder";
CREATE POLICY repair_order_tenant_all ON "RepairOrder"
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
      AND (
        NULLIF(current_setting('app.dealer_id', true), '') IS NULL
        OR "dealer_id" IS NULL
        OR "dealer_id" = current_setting('app.dealer_id', true)
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
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── RepairLine ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS repair_line_tenant_all ON "RepairLine";
CREATE POLICY repair_line_tenant_all ON "RepairLine"
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
        SELECT 1 FROM "RepairOrder" ro
        WHERE ro."id" = "RepairLine"."repairOrderId"
          AND ro."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "RepairOrder" ro
        WHERE ro."id" = "RepairLine"."repairOrderId"
          AND ro."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

-- ─── ServiceAdvisor ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS service_advisor_tenant_all ON "ServiceAdvisor";
CREATE POLICY service_advisor_tenant_all ON "ServiceAdvisor"
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

-- ─── ServiceAdvisorAlias ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS service_advisor_alias_tenant_all ON "ServiceAdvisorAlias";
CREATE POLICY service_advisor_alias_tenant_all ON "ServiceAdvisorAlias"
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
        SELECT 1 FROM "ServiceAdvisor" sa
        WHERE sa."id" = "ServiceAdvisorAlias"."serviceAdvisorId"
          AND sa."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "ServiceAdvisor" sa
        WHERE sa."id" = "ServiceAdvisorAlias"."serviceAdvisorId"
          AND sa."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

-- ─── AdvisorComplaintObservation ─────────────────────────────────────────────
DROP POLICY IF EXISTS advisor_observation_tenant_all ON "AdvisorComplaintObservation";
CREATE POLICY advisor_observation_tenant_all ON "AdvisorComplaintObservation"
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

-- ─── AdvisorWritingProfile ───────────────────────────────────────────────────
DROP POLICY IF EXISTS advisor_writing_profile_tenant_all ON "AdvisorWritingProfile";
CREATE POLICY advisor_writing_profile_tenant_all ON "AdvisorWritingProfile"
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
        SELECT 1 FROM "ServiceAdvisor" sa
        WHERE sa."id" = "AdvisorWritingProfile"."serviceAdvisorId"
          AND sa."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "ServiceAdvisor" sa
        WHERE sa."id" = "AdvisorWritingProfile"."serviceAdvisorId"
          AND sa."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

-- ─── AuditLog ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_log_tenant_select ON "AuditLog";
CREATE POLICY audit_log_tenant_select ON "AuditLog"
  FOR SELECT
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
    OR (
      current_setting('app.scope_mode', true) = 'national'
      AND "action" LIKE 'owner.%'
    )
  );

DROP POLICY IF EXISTS audit_log_tenant_insert ON "AuditLog";
CREATE POLICY audit_log_tenant_insert ON "AuditLog"
  FOR INSERT
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
    OR (
      current_setting('app.scope_mode', true) = 'national'
      AND "action" LIKE 'owner.%'
    )
  );

-- ─── TechnicianCertifiedStory ────────────────────────────────────────────────
DROP POLICY IF EXISTS certified_story_tenant_all ON "TechnicianCertifiedStory";
CREATE POLICY certified_story_tenant_all ON "TechnicianCertifiedStory"
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

-- ─── TechnicianActivityLog ───────────────────────────────────────────────────
DROP POLICY IF EXISTS technician_activity_tenant_all ON "TechnicianActivityLog";
CREATE POLICY technician_activity_tenant_all ON "TechnicianActivityLog"
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

-- ─── Template ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS template_tenant_all ON "Template";
CREATE POLICY template_tenant_all ON "Template"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
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
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── KnowledgeBase ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS knowledge_base_tenant_all ON "KnowledgeBase";
CREATE POLICY knowledge_base_tenant_all ON "KnowledgeBase"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
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
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── TechnicianDealership ────────────────────────────────────────────────────
DROP POLICY IF EXISTS tech_dealership_membership_all ON "TechnicianDealership";
CREATE POLICY tech_dealership_membership_all ON "TechnicianDealership"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  );

-- ─── SessionRefreshToken ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS refresh_token_owner_all ON "SessionRefreshToken";
CREATE POLICY refresh_token_owner_all ON "SessionRefreshToken"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
  );

-- =============================================================================
-- NEW: Technician (staff accounts — multi-tenant)
-- =============================================================================
ALTER TABLE "Technician" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Technician" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_tenant_all ON "Technician";
CREATE POLICY technician_tenant_all ON "Technician"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    -- Self
    OR "id" = NULLIF(current_setting('app.technician_id', true), '')
    -- Same rooftop staff when in dealership scope
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
    -- National owner row on sentinel (platform operator home FK)
    OR (
      current_setting('app.scope_mode', true) = 'national'
      AND "role" = 'owner'
      AND "dealershipId" = '__apex_national__'
    )
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "id" = NULLIF(current_setting('app.technician_id', true), '')
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
    OR (
      current_setting('app.scope_mode', true) = 'national'
      AND "role" = 'owner'
      AND "dealershipId" = '__apex_national__'
    )
  );

-- =============================================================================
-- NEW: UsageLog (per-dealership AI usage)
-- =============================================================================
ALTER TABLE "UsageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_log_tenant_all ON "UsageLog";
CREATE POLICY usage_log_tenant_all ON "UsageLog"
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
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
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
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
  );

-- =============================================================================
-- NEW: DealerGroupMembership (group owner portfolio)
-- Columns are snake_case via Prisma @map (see 20250714120000_apex_dealer_group):
--   technician_id, dealer_group_id, is_primary, is_active, created_at
-- Do NOT use camelCase "technicianId" here — Postgres column is "technician_id".
-- =============================================================================
ALTER TABLE "DealerGroupMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealerGroupMembership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dealer_group_membership_all ON "DealerGroupMembership";
CREATE POLICY dealer_group_membership_all ON "DealerGroupMembership"
  FOR ALL
  USING (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technician_id" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.rls_soft_open', true), ''), 'off') = 'on'
      AND COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    )
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technician_id" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  );
