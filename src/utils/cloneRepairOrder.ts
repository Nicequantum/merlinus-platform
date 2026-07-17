import type { ExtractedData, RepairLine, RepairOrder } from '@/types';

function cloneExtractedData(data: ExtractedData | undefined): ExtractedData | undefined {
  if (!data) return undefined;
  return {
    codes: data.codes ? data.codes.slice() : [],
    faultCodes: data.faultCodes ? data.faultCodes.slice() : [],
    guidedTests: data.guidedTests ? data.guidedTests.slice() : [],
    measurements: data.measurements ? data.measurements.slice() : [],
    components: data.components ? data.components.slice() : [],
    circuits: data.circuits ? data.circuits.slice() : [],
  };
}

function cloneLine(line: RepairLine): RepairLine {
  return {
    ...line,
    xentryImages: line.xentryImages ? line.xentryImages.slice() : [],
    xentryOcrTexts: line.xentryOcrTexts ? line.xentryOcrTexts.slice() : undefined,
    extractedData: cloneExtractedData(line.extractedData),
    soldMetrics: line.soldMetrics ? { ...line.soldMetrics } : undefined,
    // Quality / certification objects are treated as immutable after assignment
    storyQualityAudit: line.storyQualityAudit,
    storyCertification: line.storyCertification,
  };
}

/**
 * Structural clone for applyROUpdate — much cheaper than structuredClone on large ROs
 * (avoids deep-cloning story text, quality JSON trees, and image blobs every keystroke).
 */
export function cloneRepairOrderForUpdate(ro: RepairOrder): RepairOrder {
  return {
    ...ro,
    vehicle: {
      ...ro.vehicle,
      warrantyInfo: ro.vehicle.warrantyInfo ? { ...ro.vehicle.warrantyInfo } : undefined,
    },
    customer: { ...ro.customer },
    complaints: ro.complaints.slice(),
    complaintIds: ro.complaintIds ? ro.complaintIds.slice() : undefined,
    complaintLabels: ro.complaintLabels ? ro.complaintLabels.slice() : undefined,
    xentryImages: ro.xentryImages ? ro.xentryImages.slice() : undefined,
    xentryOcrTexts: ro.xentryOcrTexts ? ro.xentryOcrTexts.slice() : undefined,
    repairLines: ro.repairLines.map(cloneLine),
  };
}
