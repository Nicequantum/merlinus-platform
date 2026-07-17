-- =============================================================================
-- PR-M5a — Voice agent lines, calls, conversations, transcript segments
-- Does not touch RepairOrder / story pipeline tables.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "VoiceAgentLine" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "e164Number" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Main',
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceAgentLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceCall" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "lineId" TEXT,
    "externalCallId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "fromEncrypted" TEXT NOT NULL DEFAULT '',
    "fromLast4" TEXT NOT NULL DEFAULT '',
    "toE164" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "recordingPathname" TEXT,
    "transcriptEncrypted" TEXT NOT NULL DEFAULT '',
    "routingPathJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceConversation" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "activeAgent" TEXT NOT NULL DEFAULT 'receptionist',
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceTranscriptSegment" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "tsMs" INTEGER NOT NULL DEFAULT 0,
    "speaker" TEXT NOT NULL,
    "textEncrypted" TEXT NOT NULL DEFAULT '',
    "agentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceTranscriptSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceAgentLine_e164Number_key" ON "VoiceAgentLine"("e164Number");
CREATE INDEX IF NOT EXISTS "VoiceAgentLine_dealershipId_isActive_idx" ON "VoiceAgentLine"("dealershipId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceCall_externalCallId_key" ON "VoiceCall"("externalCallId");
CREATE INDEX IF NOT EXISTS "VoiceCall_dealershipId_createdAt_idx" ON "VoiceCall"("dealershipId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "VoiceCall_dealershipId_status_idx" ON "VoiceCall"("dealershipId", "status");
CREATE INDEX IF NOT EXISTS "VoiceCall_lineId_idx" ON "VoiceCall"("lineId");

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceConversation_callId_key" ON "VoiceConversation"("callId");
CREATE INDEX IF NOT EXISTS "VoiceConversation_dealershipId_activeAgent_idx" ON "VoiceConversation"("dealershipId", "activeAgent");

CREATE INDEX IF NOT EXISTS "VoiceTranscriptSegment_callId_createdAt_idx" ON "VoiceTranscriptSegment"("callId", "createdAt");
CREATE INDEX IF NOT EXISTS "VoiceTranscriptSegment_callId_tsMs_idx" ON "VoiceTranscriptSegment"("callId", "tsMs");

ALTER TABLE "VoiceAgentLine" DROP CONSTRAINT IF EXISTS "VoiceAgentLine_dealershipId_fkey";
ALTER TABLE "VoiceAgentLine"
  ADD CONSTRAINT "VoiceAgentLine_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceCall" DROP CONSTRAINT IF EXISTS "VoiceCall_dealershipId_fkey";
ALTER TABLE "VoiceCall"
  ADD CONSTRAINT "VoiceCall_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceCall" DROP CONSTRAINT IF EXISTS "VoiceCall_lineId_fkey";
ALTER TABLE "VoiceCall"
  ADD CONSTRAINT "VoiceCall_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "VoiceAgentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoiceConversation" DROP CONSTRAINT IF EXISTS "VoiceConversation_callId_fkey";
ALTER TABLE "VoiceConversation"
  ADD CONSTRAINT "VoiceConversation_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceConversation" DROP CONSTRAINT IF EXISTS "VoiceConversation_dealershipId_fkey";
ALTER TABLE "VoiceConversation"
  ADD CONSTRAINT "VoiceConversation_dealershipId_fkey"
  FOREIGN KEY ("dealershipId") REFERENCES "Dealership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceTranscriptSegment" DROP CONSTRAINT IF EXISTS "VoiceTranscriptSegment_callId_fkey";
ALTER TABLE "VoiceTranscriptSegment"
  ADD CONSTRAINT "VoiceTranscriptSegment_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "VoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (dealership-scoped; webhooks use withRlsContext for the line's rooftop)
ALTER TABLE "VoiceAgentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoiceAgentLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_agent_line_tenant_all ON "VoiceAgentLine";
CREATE POLICY voice_agent_line_tenant_all ON "VoiceAgentLine"
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

ALTER TABLE "VoiceCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoiceCall" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_call_tenant_all ON "VoiceCall";
CREATE POLICY voice_call_tenant_all ON "VoiceCall"
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

ALTER TABLE "VoiceConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoiceConversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_conversation_tenant_all ON "VoiceConversation";
CREATE POLICY voice_conversation_tenant_all ON "VoiceConversation"
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

ALTER TABLE "VoiceTranscriptSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoiceTranscriptSegment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_transcript_segment_tenant_all ON "VoiceTranscriptSegment";
CREATE POLICY voice_transcript_segment_tenant_all ON "VoiceTranscriptSegment"
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
        SELECT 1 FROM "VoiceCall" c
        WHERE c."id" = "VoiceTranscriptSegment"."callId"
          AND c."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
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
        SELECT 1 FROM "VoiceCall" c
        WHERE c."id" = "VoiceTranscriptSegment"."callId"
          AND c."dealershipId" = NULLIF(current_setting('app.active_dealership_id', true), '')
      )
    )
  );
