-- =============================================================================
-- APEX NATIONAL PLATFORM — Phase 6.1 RLS foundation
-- =============================================================================
-- Enables Row Level Security (FORCE) on PII / tenant-scoped tables.
--
-- Session variables (set via set_config / rlsContext.ts inside transactions):
--   app.rls_enforced           'on' = enforce tenant policies; otherwise soft-open
--   app.rls_bypass             'on' = service/seed bypass (fail-closed only when enforced)
--   app.scope_mode             'national' | 'dealership'
--   app.active_dealership_id   rooftop id for dealership-scoped access
--   app.dealer_id              optional franchise filter
--   app.technician_id          actor id (membership / refresh-token policies)
--
-- Soft-open: when app.rls_enforced is not 'on', policies allow access so Merlinus
-- and existing Prisma paths keep working. With RLS_ENABLED=true the app sets
-- enforced=on inside withRlsContext() transactions for defense-in-depth.
-- =============================================================================

-- ─── helper predicate notes ──────────────────────────────────────────────────
-- Policies intentionally use current_setting(..., true) (missing_ok) so unset
-- vars do not throw. nullif(..., '') treats empty string as absent.

-- ─── RepairOrder ─────────────────────────────────────────────────────────────
ALTER TABLE "RepairOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairOrder" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_order_tenant_all ON "RepairOrder";
CREATE POLICY repair_order_tenant_all ON "RepairOrder"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── RepairLine (via parent RepairOrder tenancy) ─────────────────────────────
ALTER TABLE "RepairLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairLine" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_line_tenant_all ON "RepairLine";
CREATE POLICY repair_line_tenant_all ON "RepairLine"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
ALTER TABLE "ServiceAdvisor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceAdvisor" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_advisor_tenant_all ON "ServiceAdvisor";
CREATE POLICY service_advisor_tenant_all ON "ServiceAdvisor"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── ServiceAdvisorAlias (via parent advisor) ────────────────────────────────
ALTER TABLE "ServiceAdvisorAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceAdvisorAlias" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_advisor_alias_tenant_all ON "ServiceAdvisorAlias";
CREATE POLICY service_advisor_alias_tenant_all ON "ServiceAdvisorAlias"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
ALTER TABLE "AdvisorComplaintObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvisorComplaintObservation" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advisor_observation_tenant_all ON "AdvisorComplaintObservation";
CREATE POLICY advisor_observation_tenant_all ON "AdvisorComplaintObservation"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── AdvisorWritingProfile (via parent advisor) ──────────────────────────────
ALTER TABLE "AdvisorWritingProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvisorWritingProfile" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advisor_writing_profile_tenant_all ON "AdvisorWritingProfile";
CREATE POLICY advisor_writing_profile_tenant_all ON "AdvisorWritingProfile"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant_select ON "AuditLog";
CREATE POLICY audit_log_tenant_select ON "AuditLog"
  FOR SELECT
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
    -- National owners: platform owner.* audit only (no dealership PII trails)
    OR (
      current_setting('app.scope_mode', true) = 'national'
      AND "action" LIKE 'owner.%'
    )
  );

DROP POLICY IF EXISTS audit_log_tenant_insert ON "AuditLog";
CREATE POLICY audit_log_tenant_insert ON "AuditLog"
  FOR INSERT
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
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

-- Append-only: no UPDATE/DELETE policies (deny by default when enforced)

-- ─── TechnicianCertifiedStory ────────────────────────────────────────────────
ALTER TABLE "TechnicianCertifiedStory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TechnicianCertifiedStory" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certified_story_tenant_all ON "TechnicianCertifiedStory";
CREATE POLICY certified_story_tenant_all ON "TechnicianCertifiedStory"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── TechnicianActivityLog ───────────────────────────────────────────────────
ALTER TABLE "TechnicianActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TechnicianActivityLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_activity_tenant_all ON "TechnicianActivityLog";
CREATE POLICY technician_activity_tenant_all ON "TechnicianActivityLog"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── Template (dealership-scoped library; __global__ shared seed rows) ───────
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Template" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_tenant_all ON "Template";
CREATE POLICY template_tenant_all ON "Template"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── KnowledgeBase ───────────────────────────────────────────────────────────
ALTER TABLE "KnowledgeBase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeBase" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_base_tenant_all ON "KnowledgeBase";
CREATE POLICY knowledge_base_tenant_all ON "KnowledgeBase"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "dealershipId" = '__global__'
    OR (
      current_setting('app.scope_mode', true) = 'dealership'
      AND "dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
    )
  );

-- ─── TechnicianDealership (membership: self or national platform ops) ────────
ALTER TABLE "TechnicianDealership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TechnicianDealership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_dealership_membership_all ON "TechnicianDealership";
CREATE POLICY tech_dealership_membership_all ON "TechnicianDealership"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
    OR current_setting('app.scope_mode', true) = 'national'
  );

-- ─── SessionRefreshToken (actor-owned only when enforced) ────────────────────
ALTER TABLE "SessionRefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionRefreshToken" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refresh_token_owner_all ON "SessionRefreshToken";
CREATE POLICY refresh_token_owner_all ON "SessionRefreshToken"
  FOR ALL
  USING (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
  )
  WITH CHECK (
    COALESCE(NULLIF(current_setting('app.rls_enforced', true), ''), 'off') <> 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "technicianId" = NULLIF(current_setting('app.technician_id', true), '')
  );
