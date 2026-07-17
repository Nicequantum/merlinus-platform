-- PR-M8 — sales/service department modules + staff roles
-- Does not touch RepairOrder / story pipeline.

DO $$ BEGIN
  ALTER TYPE "TechnicianRole" ADD VALUE 'sales';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "TechnicianRole" ADD VALUE 'service';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ModuleId" ADD VALUE 'sales';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ModuleId" ADD VALUE 'service';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
