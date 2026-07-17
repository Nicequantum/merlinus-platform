-- CreateTable
CREATE TABLE "TechnicianActivityLog" (
    "id" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "repairLineId" TEXT,
    "clientSessionId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicianActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_technicianId_createdAt_idx" ON "TechnicianActivityLog"("technicianId", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_dealershipId_category_createdAt_idx" ON "TechnicianActivityLog"("dealershipId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_repairLineId_createdAt_idx" ON "TechnicianActivityLog"("repairLineId", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_clientSessionId_createdAt_idx" ON "TechnicianActivityLog"("clientSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "TechnicianActivityLog" ADD CONSTRAINT "TechnicianActivityLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE CASCADE ON UPDATE CASCADE;