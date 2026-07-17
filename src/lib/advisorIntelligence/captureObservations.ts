import 'server-only';

import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';
import { encryptPII } from '@/lib/encryption';
import { complaintLineLabel, inferVehicleFamily } from './nameUtils';
import { recomputeAdvisorProfile } from './recomputeProfile';
import { resolveServiceAdvisor, type ResolvedServiceAdvisor } from './resolveAdvisor';

export type AdvisorExtractionSource = 'grok' | 'ocr_fallback' | 'manual';

export interface CaptureAdvisorIntelligenceInput {
  dealershipId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on writes. */
  dealerId?: string | null;
  repairOrderId: string;
  serviceAdvisorName?: string;
  complaints: string[];
  complaintLabels?: string[];
  vehicle: { make?: string; model?: string };
  extractionSource: AdvisorExtractionSource;
  extractionConfidence?: number;
  wasCorrected?: boolean;
}

export interface CaptureAdvisorIntelligenceResult {
  serviceAdvisor: ResolvedServiceAdvisor | null;
}

type DbClient = RlsDbClient;

export async function captureAdvisorIntelligence(
  input: CaptureAdvisorIntelligenceInput,
  client: DbClient = getRlsDb()
): Promise<CaptureAdvisorIntelligenceResult> {
  const complaints = input.complaints.map((c) => c.trim()).filter((c) => c.length >= 3);
  const advisorName = input.serviceAdvisorName?.trim();

  if (!advisorName) {
    return { serviceAdvisor: null };
  }

  const existingRo = await client.repairOrder.findFirst({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    select: { serviceAdvisorId: true },
  });

  const alreadyLinked = Boolean(existingRo?.serviceAdvisorId);
  const resolved = await resolveServiceAdvisor(input.dealershipId, advisorName, client, {
    incrementRoCount: !alreadyLinked,
    dealerId: input.dealerId,
  });
  if (!resolved) {
    return { serviceAdvisor: null };
  }

  const vehicleFamily = inferVehicleFamily(input.vehicle.make || '', input.vehicle.model || '');

  await client.repairOrder.updateMany({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    data: {
      serviceAdvisorId: resolved.id,
      serviceAdvisorNameEncrypted: encryptPII(advisorName),
      advisorMatchConfidence: resolved.matchConfidence,
      advisorIdentifiedAt: new Date(),
      // APEX NATIONAL PLATFORM — stamp dealerId when provided by caller session.
      ...dealerIdWriteFields(input.dealerId),
    },
  });

  await client.advisorComplaintObservation.deleteMany({
    where: { repairOrderId: input.repairOrderId },
  });

  if (complaints.length > 0) {
    await client.advisorComplaintObservation.createMany({
      data: complaints.map((complaint, index) => ({
        dealershipId: input.dealershipId,
        ...dealerIdWriteFields(input.dealerId),
        serviceAdvisorId: resolved.id,
        repairOrderId: input.repairOrderId,
        lineLabel: input.complaintLabels?.[index] || complaintLineLabel(index),
        complaintTextEncrypted: encryptPII(complaint),
        extractionSource: input.extractionSource,
        extractionConfidence: input.extractionConfidence ?? null,
        wasCorrected: input.wasCorrected ?? false,
        vehicleMake: input.vehicle.make || null,
        vehicleModel: input.vehicle.model || null,
        vehicleFamily,
      })),
    });
  }

  await recomputeAdvisorProfile(resolved.id, client);

  return { serviceAdvisor: resolved };
}