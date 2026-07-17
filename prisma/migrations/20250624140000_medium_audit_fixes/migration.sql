-- M7/M11: expanded PII encryption columns + TechnicianRole enum

CREATE TYPE "TechnicianRole" AS ENUM ('technician', 'manager');

ALTER TABLE "RepairOrder" ADD COLUMN IF NOT EXISTS "roNumberEncrypted" TEXT NOT NULL DEFAULT '';

ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "descriptionEncrypted" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ServiceAdvisor" ADD COLUMN IF NOT EXISTS "displayNameEncrypted" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Technician" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Technician"
  ALTER COLUMN "role" TYPE "TechnicianRole"
  USING (
    CASE
      WHEN "role" = 'manager' THEN 'manager'::"TechnicianRole"
      ELSE 'technician'::"TechnicianRole"
    END
  );
ALTER TABLE "Technician" ALTER COLUMN "role" SET DEFAULT 'technician';