-- Sophia Personal Tailoring — per-dealership department customizations + version history.

CREATE TABLE IF NOT EXISTS "DepartmentCustomization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "customInstructions" TEXT NOT NULL DEFAULT '',
    "greeting" TEXT NOT NULL DEFAULT '',
    "disclaimers" TEXT NOT NULL DEFAULT '',
    "toneGuidelines" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByTechnicianId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepartmentCustomization_dealershipId_fkey"
      FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentCustomization_dealershipId_department_key"
  ON "DepartmentCustomization"("dealershipId", "department");
CREATE INDEX IF NOT EXISTS "DepartmentCustomization_dealershipId_department_idx"
  ON "DepartmentCustomization"("dealershipId", "department");

CREATE TABLE IF NOT EXISTS "DepartmentCustomizationVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "customInstructions" TEXT NOT NULL DEFAULT '',
    "greeting" TEXT NOT NULL DEFAULT '',
    "disclaimers" TEXT NOT NULL DEFAULT '',
    "toneGuidelines" TEXT NOT NULL DEFAULT '',
    "changedByTechnicianId" TEXT,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentCustomizationVersion_customizationId_fkey"
      FOREIGN KEY ("customizationId") REFERENCES "DepartmentCustomization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentCustomizationVersion_customizationId_version_key"
  ON "DepartmentCustomizationVersion"("customizationId", "version");
CREATE INDEX IF NOT EXISTS "DepartmentCustomizationVersion_customizationId_createdAt_idx"
  ON "DepartmentCustomizationVersion"("customizationId", "createdAt");
