-- Customer Pay template fields and repair-line workflow flag
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isCustomerPay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "templateType" TEXT NOT NULL DEFAULT 'Warranty';
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "description" TEXT;

ALTER TABLE "RepairLine" ADD COLUMN IF NOT EXISTS "isCustomerPay" BOOLEAN NOT NULL DEFAULT false;

-- Align existing customer-category seed rows
UPDATE "Template"
SET "isCustomerPay" = true, "templateType" = 'CustomerPay'
WHERE "category" = 'customer' AND "source" = 'seed';