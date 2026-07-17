import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { hashPassword } from '@/lib/auth';
import { getRlsDb, rlsTransaction } from '@/lib/apex/rlsContext';
import { internalEmailForD7 } from '@/lib/d7Number';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';
import { apiError } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import {
  AdvisorManagementError,
  createManualServiceAdvisor,
} from '@/lib/serviceAdvisorManagement';
import {
  createUserSchema,
  parseRequestBody,
  resolveServiceAdvisorLinkMode,
} from '@/lib/validation';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const users = await getRlsDb().technician.findMany({
        where: { dealershipId: session.dealershipId },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          consentAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        users: users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          consentAt: u.consentAt?.toISOString() ?? null,
          deletedAt: u.deletedAt?.toISOString() ?? null,
        })),
      };
    },
    { rateLimitKey: 'users.list', requireManager: true }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createUserSchema);
      if ('error' in parsed) return parsed.error;

      const {
        d7Number,
        name,
        password,
        role,
        serviceAdvisorId,
        newAdvisorDisplayName,
        newAdvisorCode,
      } = parsed.data;

      const existing = await getRlsDb().technician.findUnique({ where: { d7Number } });
      if (existing) {
        return apiError('An account with this D7 number already exists.', 409);
      }

      const passwordHash = await hashPassword(password);
      // APEX NATIONAL PLATFORM — stamp dealerId on user writes from manager session when present.
      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));
      const resolvedRole = role ?? 'technician';
      const linkMode = resolveServiceAdvisorLinkMode({
        role: resolvedRole,
        serviceAdvisorLinkMode: parsed.data.serviceAdvisorLinkMode,
        serviceAdvisorId,
      });

      try {
        if (resolvedRole === 'service_advisor' && linkMode === 'existing') {
          const linkedAdvisor = await getRlsDb().serviceAdvisor.findFirst({
            where: {
              id: serviceAdvisorId,
              dealershipId: session.dealershipId,
              deletedAt: null,
              status: 'active',
            },
          });
          if (!linkedAdvisor) {
            return apiError('Select a valid active service advisor profile to link.', 400);
          }

          const existingLink = await getRlsDb().technician.findFirst({
            where: {
              serviceAdvisorId,
              deletedAt: null,
              isActive: true,
            },
          });
          if (existingLink) {
            return apiError('This service advisor profile already has a login account.', 409);
          }

          const user = await getRlsDb().technician.create({
            data: {
              d7Number,
              email: internalEmailForD7(d7Number),
              name: name.trim(),
              passwordHash,
              role: resolvedRole,
              isActive: true,
              dealershipId: session.dealershipId,
              ...dealerFields,
              serviceAdvisorId,
            },
            select: {
              id: true,
              d7Number: true,
              name: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          });

          await writeAuditedAccess({
            action: 'user.create',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: user.id,
            metadata: {
              d7Number: user.d7Number,
              role: user.role,
              serviceAdvisorId,
              serviceAdvisorLinkMode: 'existing',
            },
            ipAddress: getRequestIp(request),
          });

          return {
            user: { ...user, createdAt: user.createdAt.toISOString() },
          };
        }

        if (resolvedRole === 'service_advisor' && linkMode === 'create') {
          const result = await rlsTransaction(async (tx) => {
            const { advisor, reactivated } = await createManualServiceAdvisor(
              session.dealershipId,
              {
                displayName: newAdvisorDisplayName!,
                advisorCode: newAdvisorCode,
              },
              tx,
              dealerFields.dealerId
            );

            const existingLink = await tx.technician.findFirst({
              where: {
                serviceAdvisorId: advisor.id,
                deletedAt: null,
                isActive: true,
              },
            });
            if (existingLink) {
              throw new AdvisorManagementError(
                'This service advisor profile already has a login account.',
                409
              );
            }

            const user = await tx.technician.create({
              data: {
                d7Number,
                email: internalEmailForD7(d7Number),
                name: name.trim(),
                passwordHash,
                role: resolvedRole,
                isActive: true,
                dealershipId: session.dealershipId,
                ...dealerFields,
                serviceAdvisorId: advisor.id,
              },
              select: {
                id: true,
                d7Number: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
              },
            });

            return { user, advisor, reactivated };
          });

          await writeAuditedAccess({
            action: result.reactivated ? 'advisor.reactivate' : 'advisor.create',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'service_advisor',
            entityId: result.advisor.id,
            metadata: {
              displayName: readAdvisorDisplayNameFromDb(result.advisor),
              advisorCode: result.advisor.advisorCode,
              manual: true,
              reactivated: result.reactivated,
              createdWithUser: true,
            },
            ipAddress: getRequestIp(request),
          });

          await writeAuditedAccess({
            action: 'user.create',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: result.user.id,
            metadata: {
              d7Number: result.user.d7Number,
              role: result.user.role,
              serviceAdvisorId: result.advisor.id,
              serviceAdvisorLinkMode: 'create',
            },
            ipAddress: getRequestIp(request),
          });

          return {
            user: { ...result.user, createdAt: result.user.createdAt.toISOString() },
          };
        }

        const user = await getRlsDb().technician.create({
          data: {
            d7Number,
            email: internalEmailForD7(d7Number),
            name: name.trim(),
            passwordHash,
            role: resolvedRole,
            isActive: true,
            dealershipId: session.dealershipId,
            ...dealerFields,
            serviceAdvisorId: null,
          },
          select: {
            id: true,
            d7Number: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        });

        await writeAuditedAccess({
          action: 'user.create',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'technician',
          entityId: user.id,
          metadata: { d7Number: user.d7Number, role: user.role },
          ipAddress: getRequestIp(request),
        });

        return {
          user: { ...user, createdAt: user.createdAt.toISOString() },
        };
      } catch (error) {
        if (error instanceof AdvisorManagementError) {
          return apiError(error.message, error.status);
        }
        throw error;
      }
    },
    { rateLimitKey: 'users.create', requireManager: true }
  );
}