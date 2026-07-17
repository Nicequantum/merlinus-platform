-- Add D7 login identifier for technicians
ALTER TABLE "Technician" ADD COLUMN "d7Number" TEXT;

-- Backfill existing accounts with stable unique D7 values
UPDATE "Technician"
SET "d7Number" = 'D7' || UPPER(SUBSTRING(REPLACE("id", '-', ''), 1, 10))
WHERE "d7Number" IS NULL;

ALTER TABLE "Technician" ALTER COLUMN "d7Number" SET NOT NULL;

CREATE UNIQUE INDEX "Technician_d7Number_key" ON "Technician"("d7Number");