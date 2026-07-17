import type { PrismaClient, Technician } from '@prisma/client';
import { createSessionToken } from '../../src/lib/auth';
import { internalEmailForD7 } from '../../src/lib/d7Number';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '../../src/types';

/** Isolated from D7TECH001 so parallel integration suites cannot race on compliance fields. */
export const JOURNEY_INTEGRATION_D7 = 'D7JOURNEY01';

/** DB fields that satisfy withAuth consent + legal disclaimer gates for integration fixtures. */
export const INTEGRATION_COMPLIANCE_DB = {
  consentAt: new Date(),
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: new Date(),
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
} as const;

export type TechnicianComplianceSnapshot = {
  consentAt: Date | null;
  consentVersion: string | null;
  legalDisclaimerAt: Date | null;
  legalDisclaimerVersion: string | null;
};

export function captureTechnicianCompliance(tech: {
  consentAt: Date | null;
  consentVersion: string | null;
  legalDisclaimerAt: Date | null;
  legalDisclaimerVersion: string | null;
}): TechnicianComplianceSnapshot {
  return {
    consentAt: tech.consentAt,
    consentVersion: tech.consentVersion,
    legalDisclaimerAt: tech.legalDisclaimerAt,
    legalDisclaimerVersion: tech.legalDisclaimerVersion,
  };
}

const journeyComplianceReset = {
  consentAt: null,
  consentVersion: null,
  legalDisclaimerAt: null,
  legalDisclaimerVersion: null,
} as const;

/** Reset onboarding gates so journey tests can exercise consent → disclaimer in order. */
export async function clearTechnicianCompliance(
  prisma: PrismaClient,
  technicianId: string
): Promise<void> {
  await prisma.technician.update({
    where: { id: technicianId },
    data: journeyComplianceReset,
  });
}

/** Dedicated technician for E2E journey — never touched by other integration fixtures. */
export async function provisionJourneyTechnician(
  prisma: PrismaClient,
  input: {
    dealershipId: string;
    passwordHash: string;
    name?: string;
  }
): Promise<Technician> {
  const d7Number = JOURNEY_INTEGRATION_D7;
  return prisma.technician.upsert({
    where: { d7Number },
    update: {
      dealershipId: input.dealershipId,
      passwordHash: input.passwordHash,
      role: 'technician',
      isAdmin: false,
      isActive: true,
      deletedAt: null,
      ...journeyComplianceReset,
    },
    create: {
      d7Number,
      email: internalEmailForD7(d7Number),
      name: input.name ?? 'Journey Integration Technician',
      passwordHash: input.passwordHash,
      role: 'technician',
      isAdmin: false,
      isActive: true,
      dealershipId: input.dealershipId,
      ...journeyComplianceReset,
    },
  });
}

export async function restoreTechnicianCompliance(
  prisma: PrismaClient,
  technicianId: string,
  snapshot: TechnicianComplianceSnapshot
): Promise<void> {
  await prisma.technician.update({
    where: { id: technicianId },
    data: snapshot,
  });
}

export async function ensureTechnicianCompliance(
  prisma: PrismaClient,
  technicianId: string
): Promise<void> {
  await prisma.technician.update({
    where: { id: technicianId },
    data: INTEGRATION_COMPLIANCE_DB,
  });
}

export function complianceFieldsFromTechnician(tech: {
  consentAt: Date | null;
  consentVersion: string | null;
  legalDisclaimerAt: Date | null;
  legalDisclaimerVersion: string | null;
}): {
  consentAt: string;
  consentVersion: string;
  legalDisclaimerAt: string;
  legalDisclaimerVersion: string;
} {
  return {
    consentAt: tech.consentAt?.toISOString() ?? INTEGRATION_COMPLIANCE_DB.consentAt.toISOString(),
    consentVersion: tech.consentVersion ?? CONSENT_VERSION,
    legalDisclaimerAt:
      tech.legalDisclaimerAt?.toISOString() ?? INTEGRATION_COMPLIANCE_DB.legalDisclaimerAt.toISOString(),
    legalDisclaimerVersion: tech.legalDisclaimerVersion ?? LEGAL_DISCLAIMER_VERSION,
  };
}

/** Ensure DB compliance then mint a JWT aligned with current policy versions. */
export async function createCompliantSessionToken(
  prisma: PrismaClient,
  technician: Technician,
  dealershipName: string
): Promise<string> {
  await ensureTechnicianCompliance(prisma, technician.id);
  const refreshed = await prisma.technician.findUniqueOrThrow({ where: { id: technician.id } });
  const compliance = complianceFieldsFromTechnician(refreshed);

  return createSessionToken({
    technicianId: refreshed.id,
    d7Number: refreshed.d7Number,
    name: refreshed.name,
    role: refreshed.role,
    isAdmin: refreshed.isAdmin,
    dealershipId: refreshed.dealershipId,
    dealershipName,
    serviceAdvisorId: refreshed.serviceAdvisorId ?? null,
    consentAt: compliance.consentAt,
    consentVersion: compliance.consentVersion,
    legalDisclaimerAt: compliance.legalDisclaimerAt,
    legalDisclaimerVersion: compliance.legalDisclaimerVersion,
    sessionVersion: refreshed.sessionVersion,
  });
}