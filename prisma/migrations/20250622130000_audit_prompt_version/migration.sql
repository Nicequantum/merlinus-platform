-- Track Merlin prompt version on every audit entry for warranty compliance traceability.
ALTER TABLE "AuditLog" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'legacy';