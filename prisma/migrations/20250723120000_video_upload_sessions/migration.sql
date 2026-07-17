-- =============================================================================
-- PR-M1b — Chunked / resumable video upload sessions
-- Does not touch RepairOrder / RepairLine / story pipeline tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "VideoUploadSession" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'video/webm',
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "receivedMask" TEXT NOT NULL DEFAULT '[]',
    "chunkPathnames" TEXT NOT NULL DEFAULT '[]',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VideoUploadSession_dealershipId_technicianId_status_idx"
  ON "VideoUploadSession"("dealershipId", "technicianId", "status");
CREATE INDEX IF NOT EXISTS "VideoUploadSession_expiresAt_idx"
  ON "VideoUploadSession"("expiresAt");

-- RLS: dealership-scoped (technician may only touch own sessions in app layer)
ALTER TABLE "VideoUploadSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoUploadSession" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_upload_session_tenant_all ON "VideoUploadSession";
CREATE POLICY video_upload_session_tenant_all ON "VideoUploadSession"
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
