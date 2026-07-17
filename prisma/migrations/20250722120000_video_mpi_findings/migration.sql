-- =============================================================================
-- PR-M1a — Video MPI findings + additive MPI columns on VideoInspection
-- Does not touch RepairOrder / RepairLine / story pipeline tables.
-- Backfills DealershipModule.video_mpi = enabled for existing rooftops
-- (Video Inspection already shipped; module gate must not brick pilots).
-- =============================================================================

-- ─── Additive columns on VideoInspection ─────────────────────────────────────
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "customerNameEncrypted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "customerPhoneLast4" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "vinEncrypted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "vinLast8" TEXT;
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "mpiChecklistJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "severitySummary" TEXT;
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "recordingMode" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "deliveryChannel" TEXT;
ALTER TABLE "VideoInspection" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "VideoInspection_dealershipId_vinLast8_idx"
  ON "VideoInspection"("dealershipId", "vinLast8");

-- ─── Findings table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VideoInspectionFinding" (
    "id" TEXT NOT NULL,
    "videoInspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ok',
    "noteEncrypted" TEXT NOT NULL DEFAULT '',
    "timestampSec" DOUBLE PRECISION,
    "framePathname" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspectionFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VideoInspectionFinding_videoInspectionId_sortOrder_idx"
  ON "VideoInspectionFinding"("videoInspectionId", "sortOrder");
CREATE INDEX IF NOT EXISTS "VideoInspectionFinding_videoInspectionId_severity_idx"
  ON "VideoInspectionFinding"("videoInspectionId", "severity");

ALTER TABLE "VideoInspectionFinding" DROP CONSTRAINT IF EXISTS "VideoInspectionFinding_videoInspectionId_fkey";
ALTER TABLE "VideoInspectionFinding"
  ADD CONSTRAINT "VideoInspectionFinding_videoInspectionId_fkey"
  FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS: VideoInspection (was missing; dealership-scoped) ───────────────────
ALTER TABLE "VideoInspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoInspection" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_inspection_tenant_all ON "VideoInspection";
CREATE POLICY video_inspection_tenant_all ON "VideoInspection"
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

-- ─── RLS: findings via parent inspection dealership ──────────────────────────
ALTER TABLE "VideoInspectionFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoInspectionFinding" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_inspection_finding_tenant_all ON "VideoInspectionFinding";
CREATE POLICY video_inspection_finding_tenant_all ON "VideoInspectionFinding"
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
        SELECT 1 FROM "VideoInspection" vi
        WHERE vi."id" = "VideoInspectionFinding"."videoInspectionId"
          AND vi."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "VideoInspection" vi
        WHERE vi."id" = "VideoInspectionFinding"."videoInspectionId"
          AND vi."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );

-- ─── Enable video_mpi for existing rooftops (do not brick live Video Inspection) ─
INSERT INTO "DealershipModule" (
  "id",
  "dealershipId",
  "moduleId",
  "enabled",
  "configJson",
  "enabledAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'dsm_vmpi_' || replace(gen_random_uuid()::text, '-', ''),
  d."id",
  'video_mpi'::"ModuleId",
  true,
  '{}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Dealership" d
ON CONFLICT ("dealershipId", "moduleId") DO UPDATE
  SET "enabled" = true,
      "enabledAt" = COALESCE("DealershipModule"."enabledAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP;
