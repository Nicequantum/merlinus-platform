-- Phase 4 Clerk authentication — optional identity link on Technician (backward compatible).
ALTER TABLE "Technician" ADD COLUMN "clerk_user_id" TEXT;
ALTER TABLE "Technician" ADD COLUMN "auth_provider" TEXT NOT NULL DEFAULT 'legacy';

CREATE UNIQUE INDEX "Technician_clerk_user_id_key" ON "Technician"("clerk_user_id");