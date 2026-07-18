-- CreateTable
CREATE TABLE "DealerGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "timezone" TEXT DEFAULT 'America/New_York',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DealerGroupMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_group_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealerGroupMembership_dealer_group_id_fkey" FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DealerGroupMembership_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dealer_group_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dealer_dealer_group_id_fkey" FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dealership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dealer_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "story_brand" TEXT NOT NULL DEFAULT 'mercedes',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dealership_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DealershipModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "enabledAt" DATETIME,
    "enabledById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DealershipModule_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DealerGroupModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_group_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "DealerGroupModule_dealer_group_id_fkey" FOREIGN KEY ("dealer_group_id") REFERENCES "DealerGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "d7Number" TEXT,
    "apexUsername" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" DATETIME,
    "clerk_user_id" TEXT,
    "auth_provider" TEXT NOT NULL DEFAULT 'legacy',
    "role" TEXT NOT NULL DEFAULT 'technician',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "serviceAdvisorId" TEXT,
    "consentAt" DATETIME,
    "consentVersion" TEXT,
    "legalDisclaimerAt" DATETIME,
    "legalDisclaimerVersion" TEXT,
    "firstAppLaunchAt" DATETIME,
    "firstAppLaunchSessionId" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Technician_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Technician_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Technician_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoInspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "repairLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "videoPathname" TEXT NOT NULL DEFAULT '',
    "contentType" TEXT NOT NULL DEFAULT 'video/webm',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "durationSec" REAL,
    "thumbnailPathname" TEXT,
    "framePathnames" TEXT NOT NULL DEFAULT '[]',
    "transcriptEncrypted" TEXT NOT NULL DEFAULT '',
    "transcriptLanguage" TEXT NOT NULL DEFAULT 'en',
    "reportEncrypted" TEXT NOT NULL DEFAULT '',
    "reportPromptVersion" TEXT NOT NULL DEFAULT '',
    "vehicleLabel" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Video inspection',
    "errorMessage" TEXT,
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "vinLast8" TEXT,
    "mpiChecklistJson" TEXT NOT NULL DEFAULT '[]',
    "severitySummary" TEXT,
    "recordingMode" TEXT NOT NULL DEFAULT 'standard',
    "deliveryChannel" TEXT,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoInspection_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoInspection_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoUploadSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'video/webm',
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "receivedMask" TEXT NOT NULL DEFAULT '[]',
    "chunkPathnames" TEXT NOT NULL DEFAULT '[]',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DepartmentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "department" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "summaryEncrypted" TEXT NOT NULL DEFAULT '',
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "customerEmailEncrypted" TEXT NOT NULL DEFAULT '',
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "vinLast8" TEXT,
    "vehicleLabel" TEXT,
    "stockOrRoHint" TEXT,
    "voiceCallId" TEXT,
    "createdById" TEXT,
    "assignedToId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepartmentRequest_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DepartmentRequest_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DepartmentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DepartmentRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartsRequestLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentRequestId" TEXT NOT NULL,
    "partNumber" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "quotedPriceCents" INTEGER,
    "vendor" TEXT,
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartsRequestLine_departmentRequestId_fkey" FOREIGN KEY ("departmentRequestId") REFERENCES "DepartmentRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartsLookupEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "departmentRequestId" TEXT,
    "query" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartsLookupEvent_departmentRequestId_fkey" FOREIGN KEY ("departmentRequestId") REFERENCES "DepartmentRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartsLookupEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "department" TEXT NOT NULL DEFAULT 'facilities',
    "title" TEXT NOT NULL,
    "descriptionEncrypted" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "locationLabel" TEXT,
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaintenanceTicket_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenancePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenancePhoto_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceTicketEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoanerVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "unitNumber" TEXT NOT NULL,
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "vinLast8" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "plateEncrypted" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'available',
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanerVehicle_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoanerAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "loanerVehicleId" TEXT NOT NULL,
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneEncrypted" TEXT NOT NULL DEFAULT '',
    "customerPhoneLast4" TEXT NOT NULL DEFAULT '',
    "repairOrderId" TEXT,
    "departmentRequestId" TEXT,
    "checkoutAt" DATETIME,
    "dueBackAt" DATETIME,
    "returnedAt" DATETIME,
    "outOdometer" INTEGER,
    "inOdometer" INTEGER,
    "fuelOut" TEXT,
    "fuelIn" TEXT,
    "damageOutJson" TEXT NOT NULL DEFAULT '[]',
    "damageInJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "createdById" TEXT,
    "notesEncrypted" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanerAssignment_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanerAssignment_loanerVehicleId_fkey" FOREIGN KEY ("loanerVehicleId") REFERENCES "LoanerVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanerAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceAgentLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "e164Number" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Main',
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceAgentLine_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealershipId" TEXT NOT NULL,
    "lineId" TEXT,
    "externalCallId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "fromEncrypted" TEXT NOT NULL DEFAULT '',
    "fromLast4" TEXT NOT NULL DEFAULT '',
    "toE164" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "durationSec" INTEGER,
    "recordingPathname" TEXT,
    "recordingSid" TEXT,
    "recordingUrl" TEXT,
    "recordingStatus" TEXT NOT NULL DEFAULT 'none',
    "transcriptEncrypted" TEXT NOT NULL DEFAULT '',
    "routingPathJson" TEXT NOT NULL DEFAULT '[]',
    "metricsJson" TEXT NOT NULL DEFAULT '{}',
    "contained" BOOLEAN,
    "outcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceCall_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VoiceCall_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "VoiceAgentLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "activeAgent" TEXT NOT NULL DEFAULT 'receptionist',
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceConversation_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VoiceConversation_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceTranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "tsMs" INTEGER NOT NULL DEFAULT 0,
    "speaker" TEXT NOT NULL,
    "textEncrypted" TEXT NOT NULL DEFAULT '',
    "agentName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceTranscriptSegment_callId_fkey" FOREIGN KEY ("callId") REFERENCES "VoiceCall" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoInspectionFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoInspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ok',
    "noteEncrypted" TEXT NOT NULL DEFAULT '',
    "timestampSec" REAL,
    "framePathname" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoInspectionFinding_videoInspectionId_fkey" FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoInspectionShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoInspectionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passcodeHash" TEXT,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdByTechnicianId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspectionShare_videoInspectionId_fkey" FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoInspectionShare_createdByTechnicianId_fkey" FOREIGN KEY ("createdByTechnicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoInspectionSmsLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoInspectionId" TEXT NOT NULL,
    "shareId" TEXT,
    "phoneEncrypted" TEXT NOT NULL DEFAULT '',
    "phoneLast4" TEXT NOT NULL DEFAULT '',
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sentByTechnicianId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoInspectionSmsLog_videoInspectionId_fkey" FOREIGN KEY ("videoInspectionId") REFERENCES "VideoInspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoInspectionSmsLog_sentByTechnicianId_fkey" FOREIGN KEY ("sentByTechnicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicianDealership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicianId" TEXT NOT NULL,
    "dealershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicianDealership_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicianDealership_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roNumberEncrypted" TEXT NOT NULL DEFAULT '',
    "roNumberSearchTokens" TEXT NOT NULL DEFAULT '[]',
    "technicianId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "serviceAdvisorId" TEXT,
    "serviceAdvisorNameEncrypted" TEXT NOT NULL DEFAULT '',
    "advisorMatchConfidence" REAL,
    "advisorIdentifiedAt" DATETIME,
    "vinEncrypted" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "make" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "engine" TEXT NOT NULL DEFAULT '',
    "mileageIn" TEXT NOT NULL DEFAULT '',
    "mileageOut" TEXT NOT NULL DEFAULT '',
    "customerNameEncrypted" TEXT NOT NULL DEFAULT '',
    "complaintsEncrypted" TEXT NOT NULL DEFAULT '[]',
    "xentryOcrTextsEncrypted" TEXT NOT NULL DEFAULT '',
    "xentryImageUrls" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RepairOrder_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RepairOrder_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RepairOrder_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RepairOrder_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceAdvisor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "displayNameEncrypted" TEXT NOT NULL DEFAULT '',
    "nameFingerprint" TEXT NOT NULL,
    "advisorCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mergedIntoId" TEXT,
    "deletedAt" DATETIME,
    "csiScore" REAL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceAdvisor_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ServiceAdvisor_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceAdvisorAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceAdvisorId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "aliasFingerprint" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceAdvisorAlias_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdvisorComplaintObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "serviceAdvisorId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "lineLabel" TEXT,
    "complaintTextEncrypted" TEXT NOT NULL,
    "extractionSource" TEXT NOT NULL,
    "extractionConfidence" REAL,
    "wasCorrected" BOOLEAN NOT NULL DEFAULT false,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "vehicleFamily" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdvisorComplaintObservation_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdvisorComplaintObservation_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdvisorComplaintObservation_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdvisorComplaintObservation_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdvisorWritingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceAdvisorId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL DEFAULT 1,
    "profileDataEncrypted" TEXT NOT NULL DEFAULT '{}',
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdvisorWritingProfile_serviceAdvisorId_fkey" FOREIGN KEY ("serviceAdvisorId") REFERENCES "ServiceAdvisor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repairOrderId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "descriptionEncrypted" TEXT NOT NULL DEFAULT '',
    "customerConcernEncrypted" TEXT NOT NULL DEFAULT '',
    "technicianNotesEncrypted" TEXT NOT NULL DEFAULT '',
    "xentryImageUrls" TEXT NOT NULL DEFAULT '[]',
    "xentryOcrTextsEncrypted" TEXT NOT NULL DEFAULT '',
    "extractedDataEncrypted" TEXT NOT NULL DEFAULT '{}',
    "warrantyStoryEncrypted" TEXT,
    "storyQualityAuditEncrypted" TEXT NOT NULL DEFAULT '',
    "isCustomerPay" BOOLEAN NOT NULL DEFAULT false,
    "soldLaborHours" REAL,
    "soldLaborAmount" REAL,
    "soldPartsAmount" REAL,
    "customerApproved" BOOLEAN,
    "isAddOn" BOOLEAN,
    "soldMetricsUpdatedAt" DATETIME,
    "storyCertifiedAt" DATETIME,
    "storyCertifiedByTechnicianId" TEXT,
    "storyCertifiedByNameEncrypted" TEXT NOT NULL DEFAULT '',
    "storyCertifiedHash" TEXT NOT NULL DEFAULT '',
    "story_generated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RepairLine_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairLine_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealership_id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "ro_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_dealership_id_fkey" FOREIGN KEY ("dealership_id") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_events_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "usage_events_ro_id_fkey" FOREIGN KEY ("ro_id") REFERENCES "RepairOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_events_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "RepairLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "isCustomerPay" BOOLEAN NOT NULL DEFAULT false,
    "templateType" TEXT NOT NULL DEFAULT 'Warranty',
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL DEFAULT '__global__',
    "createdById" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Template_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "generatedTextEncrypted" TEXT,
    "fullOriginalTextEncrypted" TEXT NOT NULL,
    "cleanTemplateEncrypted" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'seed',
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL DEFAULT '__global__',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeBase_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "technicianId" TEXT,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'legacy',
    "previousHash" TEXT NOT NULL DEFAULT 'GENESIS',
    "entryHash" TEXT NOT NULL DEFAULT '',
    "auth_source" TEXT,
    "scope_mode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionRefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicianId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionRefreshToken_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicianCertifiedStory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "repairLineId" TEXT NOT NULL,
    "roNumber" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "certifiedAt" DATETIME NOT NULL,
    "certifiedByName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'legacy',
    "auditLogId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicianCertifiedStory_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TechnicianCertifiedStory_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicianActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "repairLineId" TEXT,
    "clientSessionId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicianActivityLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TechnicianActivityLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "technicianId" TEXT NOT NULL,
    "dealer_id" TEXT,
    "dealershipId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UsageLog_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "Dealer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UsageLog_dealershipId_fkey" FOREIGN KEY ("dealershipId") REFERENCES "Dealership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DealerGroup_code_key" ON "DealerGroup"("code");

-- CreateIndex
CREATE INDEX "DealerGroup_status_idx" ON "DealerGroup"("status");

-- CreateIndex
CREATE INDEX "DealerGroupMembership_technician_id_is_active_idx" ON "DealerGroupMembership"("technician_id", "is_active");

-- CreateIndex
CREATE INDEX "DealerGroupMembership_dealer_group_id_idx" ON "DealerGroupMembership"("dealer_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "DealerGroupMembership_dealer_group_id_technician_id_key" ON "DealerGroupMembership"("dealer_group_id", "technician_id");

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_code_key" ON "Dealer"("code");

-- CreateIndex
CREATE INDEX "Dealer_status_idx" ON "Dealer"("status");

-- CreateIndex
CREATE INDEX "Dealer_dealer_group_id_idx" ON "Dealer"("dealer_group_id");

-- CreateIndex
CREATE INDEX "Dealership_dealer_id_idx" ON "Dealership"("dealer_id");

-- CreateIndex
CREATE INDEX "DealershipModule_dealershipId_enabled_idx" ON "DealershipModule"("dealershipId", "enabled");

-- CreateIndex
CREATE INDEX "DealershipModule_moduleId_enabled_idx" ON "DealershipModule"("moduleId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DealershipModule_dealershipId_moduleId_key" ON "DealershipModule"("dealershipId", "moduleId");

-- CreateIndex
CREATE INDEX "DealerGroupModule_dealer_group_id_enabled_idx" ON "DealerGroupModule"("dealer_group_id", "enabled");

-- CreateIndex
CREATE INDEX "DealerGroupModule_module_id_enabled_idx" ON "DealerGroupModule"("module_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DealerGroupModule_dealer_group_id_module_id_key" ON "DealerGroupModule"("dealer_group_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_email_key" ON "Technician"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_d7Number_key" ON "Technician"("d7Number");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_apexUsername_key" ON "Technician"("apexUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_clerk_user_id_key" ON "Technician"("clerk_user_id");

-- CreateIndex
CREATE INDEX "Technician_dealer_id_idx" ON "Technician"("dealer_id");

-- CreateIndex
CREATE INDEX "Technician_dealershipId_idx" ON "Technician"("dealershipId");

-- CreateIndex
CREATE INDEX "Technician_isActive_idx" ON "Technician"("isActive");

-- CreateIndex
CREATE INDEX "Technician_deletedAt_idx" ON "Technician"("deletedAt");

-- CreateIndex
CREATE INDEX "Technician_serviceAdvisorId_idx" ON "Technician"("serviceAdvisorId");

-- CreateIndex
CREATE INDEX "Technician_apexUsername_idx" ON "Technician"("apexUsername");

-- CreateIndex
CREATE INDEX "Technician_dealershipId_isActive_deletedAt_idx" ON "Technician"("dealershipId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "VideoInspection_dealershipId_createdAt_idx" ON "VideoInspection"("dealershipId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VideoInspection_technicianId_createdAt_idx" ON "VideoInspection"("technicianId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VideoInspection_dealershipId_status_idx" ON "VideoInspection"("dealershipId", "status");

-- CreateIndex
CREATE INDEX "VideoInspection_dealer_id_idx" ON "VideoInspection"("dealer_id");

-- CreateIndex
CREATE INDEX "VideoInspection_dealershipId_vinLast8_idx" ON "VideoInspection"("dealershipId", "vinLast8");

-- CreateIndex
CREATE INDEX "VideoUploadSession_dealershipId_technicianId_status_idx" ON "VideoUploadSession"("dealershipId", "technicianId", "status");

-- CreateIndex
CREATE INDEX "VideoUploadSession_expiresAt_idx" ON "VideoUploadSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DepartmentRequest_dealershipId_department_status_createdAt_idx" ON "DepartmentRequest"("dealershipId", "department", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DepartmentRequest_dealershipId_vinLast8_idx" ON "DepartmentRequest"("dealershipId", "vinLast8");

-- CreateIndex
CREATE INDEX "DepartmentRequest_dealershipId_customerPhoneLast4_idx" ON "DepartmentRequest"("dealershipId", "customerPhoneLast4");

-- CreateIndex
CREATE INDEX "DepartmentRequest_assignedToId_status_idx" ON "DepartmentRequest"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "DepartmentRequest_dealer_id_idx" ON "DepartmentRequest"("dealer_id");

-- CreateIndex
CREATE INDEX "PartsRequestLine_departmentRequestId_sortOrder_idx" ON "PartsRequestLine"("departmentRequestId", "sortOrder");

-- CreateIndex
CREATE INDEX "PartsRequestLine_departmentRequestId_status_idx" ON "PartsRequestLine"("departmentRequestId", "status");

-- CreateIndex
CREATE INDEX "PartsLookupEvent_dealershipId_createdAt_idx" ON "PartsLookupEvent"("dealershipId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PartsLookupEvent_departmentRequestId_createdAt_idx" ON "PartsLookupEvent"("departmentRequestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MaintenanceTicket_dealershipId_status_severity_idx" ON "MaintenanceTicket"("dealershipId", "status", "severity");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_dealershipId_createdAt_idx" ON "MaintenanceTicket"("dealershipId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MaintenanceTicket_assignedToId_status_idx" ON "MaintenanceTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_dealer_id_idx" ON "MaintenanceTicket"("dealer_id");

-- CreateIndex
CREATE INDEX "MaintenancePhoto_ticketId_createdAt_idx" ON "MaintenancePhoto"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceTicketEvent_ticketId_createdAt_idx" ON "MaintenanceTicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceTicketEvent_actorId_idx" ON "MaintenanceTicketEvent"("actorId");

-- CreateIndex
CREATE INDEX "LoanerVehicle_dealershipId_status_idx" ON "LoanerVehicle"("dealershipId", "status");

-- CreateIndex
CREATE INDEX "LoanerVehicle_dealershipId_vinLast8_idx" ON "LoanerVehicle"("dealershipId", "vinLast8");

-- CreateIndex
CREATE INDEX "LoanerVehicle_dealer_id_idx" ON "LoanerVehicle"("dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "LoanerVehicle_dealershipId_unitNumber_key" ON "LoanerVehicle"("dealershipId", "unitNumber");

-- CreateIndex
CREATE INDEX "LoanerAssignment_dealershipId_status_createdAt_idx" ON "LoanerAssignment"("dealershipId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LoanerAssignment_loanerVehicleId_status_idx" ON "LoanerAssignment"("loanerVehicleId", "status");

-- CreateIndex
CREATE INDEX "LoanerAssignment_dealershipId_customerPhoneLast4_idx" ON "LoanerAssignment"("dealershipId", "customerPhoneLast4");

-- CreateIndex
CREATE INDEX "LoanerAssignment_dealer_id_idx" ON "LoanerAssignment"("dealer_id");

-- CreateIndex
CREATE INDEX "VoiceAgentLine_dealershipId_isActive_idx" ON "VoiceAgentLine"("dealershipId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceAgentLine_e164Number_key" ON "VoiceAgentLine"("e164Number");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCall_externalCallId_key" ON "VoiceCall"("externalCallId");

-- CreateIndex
CREATE INDEX "VoiceCall_dealershipId_createdAt_idx" ON "VoiceCall"("dealershipId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VoiceCall_dealershipId_status_idx" ON "VoiceCall"("dealershipId", "status");

-- CreateIndex
CREATE INDEX "VoiceCall_dealershipId_contained_idx" ON "VoiceCall"("dealershipId", "contained");

-- CreateIndex
CREATE INDEX "VoiceCall_dealershipId_outcome_idx" ON "VoiceCall"("dealershipId", "outcome");

-- CreateIndex
CREATE INDEX "VoiceCall_lineId_idx" ON "VoiceCall"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceConversation_callId_key" ON "VoiceConversation"("callId");

-- CreateIndex
CREATE INDEX "VoiceConversation_dealershipId_activeAgent_idx" ON "VoiceConversation"("dealershipId", "activeAgent");

-- CreateIndex
CREATE INDEX "VoiceTranscriptSegment_callId_createdAt_idx" ON "VoiceTranscriptSegment"("callId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceTranscriptSegment_callId_tsMs_idx" ON "VoiceTranscriptSegment"("callId", "tsMs");

-- CreateIndex
CREATE INDEX "VideoInspectionFinding_videoInspectionId_sortOrder_idx" ON "VideoInspectionFinding"("videoInspectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "VideoInspectionFinding_videoInspectionId_severity_idx" ON "VideoInspectionFinding"("videoInspectionId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "VideoInspectionShare_tokenHash_key" ON "VideoInspectionShare"("tokenHash");

-- CreateIndex
CREATE INDEX "VideoInspectionShare_videoInspectionId_idx" ON "VideoInspectionShare"("videoInspectionId");

-- CreateIndex
CREATE INDEX "VideoInspectionShare_createdByTechnicianId_idx" ON "VideoInspectionShare"("createdByTechnicianId");

-- CreateIndex
CREATE INDEX "VideoInspectionSmsLog_videoInspectionId_createdAt_idx" ON "VideoInspectionSmsLog"("videoInspectionId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoInspectionSmsLog_sentByTechnicianId_idx" ON "VideoInspectionSmsLog"("sentByTechnicianId");

-- CreateIndex
CREATE INDEX "TechnicianDealership_technicianId_idx" ON "TechnicianDealership"("technicianId");

-- CreateIndex
CREATE INDEX "TechnicianDealership_dealershipId_idx" ON "TechnicianDealership"("dealershipId");

-- CreateIndex
CREATE INDEX "TechnicianDealership_technicianId_isActive_idx" ON "TechnicianDealership"("technicianId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianDealership_technicianId_dealershipId_key" ON "TechnicianDealership"("technicianId", "dealershipId");

-- CreateIndex
CREATE INDEX "RepairOrder_technicianId_idx" ON "RepairOrder"("technicianId");

-- CreateIndex
CREATE INDEX "RepairOrder_dealer_id_idx" ON "RepairOrder"("dealer_id");

-- CreateIndex
CREATE INDEX "RepairOrder_dealershipId_idx" ON "RepairOrder"("dealershipId");

-- CreateIndex
CREATE INDEX "RepairOrder_serviceAdvisorId_idx" ON "RepairOrder"("serviceAdvisorId");

-- CreateIndex
CREATE INDEX "RepairOrder_dealer_id_dealershipId_idx" ON "RepairOrder"("dealer_id", "dealershipId");

-- CreateIndex
CREATE INDEX "RepairOrder_dealershipId_dealer_id_updatedAt_idx" ON "RepairOrder"("dealershipId", "dealer_id", "updatedAt");

-- CreateIndex
CREATE INDEX "RepairOrder_dealershipId_updatedAt_idx" ON "RepairOrder"("dealershipId", "updatedAt");

-- CreateIndex
CREATE INDEX "RepairOrder_dealershipId_serviceAdvisorId_updatedAt_idx" ON "RepairOrder"("dealershipId", "serviceAdvisorId", "updatedAt");

-- CreateIndex
CREATE INDEX "ServiceAdvisor_dealer_id_idx" ON "ServiceAdvisor"("dealer_id");

-- CreateIndex
CREATE INDEX "ServiceAdvisor_dealershipId_lastSeenAt_idx" ON "ServiceAdvisor"("dealershipId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ServiceAdvisor_dealershipId_status_idx" ON "ServiceAdvisor"("dealershipId", "status");

-- CreateIndex
CREATE INDEX "ServiceAdvisor_dealershipId_dealer_id_status_idx" ON "ServiceAdvisor"("dealershipId", "dealer_id", "status");

-- CreateIndex
CREATE INDEX "ServiceAdvisor_dealershipId_deletedAt_idx" ON "ServiceAdvisor"("dealershipId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAdvisor_dealershipId_nameFingerprint_key" ON "ServiceAdvisor"("dealershipId", "nameFingerprint");

-- CreateIndex
CREATE INDEX "ServiceAdvisorAlias_aliasFingerprint_idx" ON "ServiceAdvisorAlias"("aliasFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAdvisorAlias_serviceAdvisorId_aliasFingerprint_key" ON "ServiceAdvisorAlias"("serviceAdvisorId", "aliasFingerprint");

-- CreateIndex
CREATE INDEX "AdvisorComplaintObservation_serviceAdvisorId_observedAt_idx" ON "AdvisorComplaintObservation"("serviceAdvisorId", "observedAt");

-- CreateIndex
CREATE INDEX "AdvisorComplaintObservation_repairOrderId_idx" ON "AdvisorComplaintObservation"("repairOrderId");

-- CreateIndex
CREATE INDEX "AdvisorComplaintObservation_dealer_id_idx" ON "AdvisorComplaintObservation"("dealer_id");

-- CreateIndex
CREATE INDEX "AdvisorComplaintObservation_dealershipId_observedAt_idx" ON "AdvisorComplaintObservation"("dealershipId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisorWritingProfile_serviceAdvisorId_key" ON "AdvisorWritingProfile"("serviceAdvisorId");

-- CreateIndex
CREATE INDEX "RepairLine_repairOrderId_idx" ON "RepairLine"("repairOrderId");

-- CreateIndex
CREATE INDEX "RepairLine_dealer_id_idx" ON "RepairLine"("dealer_id");

-- CreateIndex
CREATE INDEX "RepairLine_storyCertifiedAt_idx" ON "RepairLine"("storyCertifiedAt");

-- CreateIndex
CREATE INDEX "RepairLine_story_generated_idx" ON "RepairLine"("story_generated");

-- CreateIndex
CREATE INDEX "usage_events_dealership_id_created_at_idx" ON "usage_events"("dealership_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_dealership_id_event_type_created_at_idx" ON "usage_events"("dealership_id", "event_type", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_ro_id_idx" ON "usage_events"("ro_id");

-- CreateIndex
CREATE INDEX "usage_events_line_id_idx" ON "usage_events"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_line_id_event_type_key" ON "usage_events"("line_id", "event_type");

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "Template"("category");

-- CreateIndex
CREATE INDEX "Template_dealer_id_idx" ON "Template"("dealer_id");

-- CreateIndex
CREATE INDEX "Template_dealershipId_lastUsedAt_idx" ON "Template"("dealershipId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "Template_source_idx" ON "Template"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Template_dealershipId_title_key" ON "Template"("dealershipId", "title");

-- CreateIndex
CREATE INDEX "KnowledgeBase_category_idx" ON "KnowledgeBase"("category");

-- CreateIndex
CREATE INDEX "KnowledgeBase_dealer_id_idx" ON "KnowledgeBase"("dealer_id");

-- CreateIndex
CREATE INDEX "KnowledgeBase_dealershipId_idx" ON "KnowledgeBase"("dealershipId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_source_idx" ON "KnowledgeBase"("source");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_dealershipId_title_key" ON "KnowledgeBase"("dealershipId", "title");

-- CreateIndex
CREATE INDEX "AuditLog_dealer_id_idx" ON "AuditLog"("dealer_id");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_idx" ON "AuditLog"("dealershipId");

-- CreateIndex
CREATE INDEX "AuditLog_technicianId_idx" ON "AuditLog"("technicianId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_createdAt_idx" ON "AuditLog"("dealershipId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_dealer_id_createdAt_idx" ON "AuditLog"("dealer_id", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_dealer_id_action_createdAt_idx" ON "AuditLog"("dealershipId", "dealer_id", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_action_createdAt_idx" ON "AuditLog"("dealershipId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_dealershipId_technicianId_action_createdAt_idx" ON "AuditLog"("dealershipId", "technicianId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRefreshToken_tokenHash_key" ON "SessionRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SessionRefreshToken_technicianId_idx" ON "SessionRefreshToken"("technicianId");

-- CreateIndex
CREATE INDEX "SessionRefreshToken_familyId_idx" ON "SessionRefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "SessionRefreshToken_expiresAt_idx" ON "SessionRefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "TechnicianCertifiedStory_technicianId_certifiedAt_idx" ON "TechnicianCertifiedStory"("technicianId", "certifiedAt" DESC);

-- CreateIndex
CREATE INDEX "TechnicianCertifiedStory_dealer_id_idx" ON "TechnicianCertifiedStory"("dealer_id");

-- CreateIndex
CREATE INDEX "TechnicianCertifiedStory_dealershipId_certifiedAt_idx" ON "TechnicianCertifiedStory"("dealershipId", "certifiedAt" DESC);

-- CreateIndex
CREATE INDEX "TechnicianCertifiedStory_repairOrderId_idx" ON "TechnicianCertifiedStory"("repairOrderId");

-- CreateIndex
CREATE INDEX "TechnicianCertifiedStory_repairLineId_idx" ON "TechnicianCertifiedStory"("repairLineId");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_technicianId_createdAt_idx" ON "TechnicianActivityLog"("technicianId", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_dealer_id_idx" ON "TechnicianActivityLog"("dealer_id");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_dealershipId_category_createdAt_idx" ON "TechnicianActivityLog"("dealershipId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_repairLineId_createdAt_idx" ON "TechnicianActivityLog"("repairLineId", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_clientSessionId_createdAt_idx" ON "TechnicianActivityLog"("clientSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_technicianId_createdAt_idx" ON "UsageLog"("technicianId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_dealer_id_idx" ON "UsageLog"("dealer_id");

-- CreateIndex
CREATE INDEX "UsageLog_dealershipId_createdAt_idx" ON "UsageLog"("dealershipId", "createdAt");
