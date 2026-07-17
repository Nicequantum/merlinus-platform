-- Apex dealer provision: force password change for newly provisioned managers.
-- Existing accounts keep must_change_password = false.

ALTER TABLE "Technician"
  ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Technician"
  ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP(3);
