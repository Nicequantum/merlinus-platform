import 'server-only';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  DATASET_DESCRIPTIONS,
  PILOT_EXPORT_DATASETS,
  PILOT_EXPORT_SCHEMA_VERSION,
  type PilotExportActor,
  type PilotExportDataset,
  type PilotExportPage,
} from '@/lib/pilotExport/types';
import { clampLimit, decodeCursor, encodeCursor } from '@/lib/pilotExport/cursor';
import { hashEmail, maskIp, scrubMetadata } from '@/lib/pilotExport/redact';
import { resolvePilotExportScope, type PilotExportScope } from '@/lib/pilotExport/scope';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { getAppVersion, getBuildCommit, isMaintenanceModeEnabled } from '@/lib/env';
import { isGrokSelfHealEnabled, getMaintenanceTimezone } from '@/lib/selfHeal/config';
import {
  loadLatestMorningReport,
  loadLatestNightlyReport,
  loadWindowState,
} from '@/lib/selfHeal/store';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import { evaluatePlatformReadiness } from '@/lib/pilotReadiness/evaluatePlatformReadiness';
import { getOwnerBillingSummary } from '@/lib/apex/ownerBillingSummary';
import { getRateLimitKv } from '@/lib/storage/workersKv';
import { isObjectStorageConfigured } from '@/lib/storage/objectStorage';
import { getGrokApiKey } from '@/lib/grokApiKey.shared';
import { APP_VERSION } from '@/lib/version';

function isDataset(v: string): v is PilotExportDataset {
  return (PILOT_EXPORT_DATASETS as readonly string[]).includes(v);
}

function pageMeta(
  dataset: PilotExportDataset,
  actor: PilotExportActor,
  scope: PilotExportScope,
  limit: number,
  nextCursor: string | null,
  notes: string[]
): PilotExportPage['meta'] {
  return {
    schemaVersion: PILOT_EXPORT_SCHEMA_VERSION,
    dataset,
    generatedAt: new Date().toISOString(),
    authMode: actor.mode,
    limit,
    nextCursor,
    hasMore: Boolean(nextCursor),
    dealershipIds: scope.dealershipIds,
    notes,
  };
}

export async function runPilotExport(input: {
  dataset: string;
  actor: PilotExportActor;
  limitRaw: string | null;
  cursorRaw: string | null;
  dealershipId?: string | null;
  since?: string | null;
  until?: string | null;
}): Promise<PilotExportPage | { ok: false; status: number; code: string; error: string }> {
  if (!isDataset(input.dataset)) {
    return {
      ok: false,
      status: 400,
      code: 'UNKNOWN_DATASET',
      error: `Unknown dataset. Valid: ${PILOT_EXPORT_DATASETS.join(', ')}`,
    };
  }

  const dataset = input.dataset;
  const limit = clampLimit(input.limitRaw, DATASET_DESCRIPTIONS[dataset].paginated ? 100 : 1, 500);
  const scope = await resolvePilotExportScope(input.actor, input.dealershipId);
  const desc = DATASET_DESCRIPTIONS[dataset];
  const notes = [
    `pii=${desc.pii}`,
    'Encrypted RO/customer/story fields are never decrypted or exported.',
    'Passwords, MFA secrets, session tokens, and env secrets are never exported.',
  ];

  if (dataset === 'manifest') {
    return {
      ok: true,
      meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
      data: PILOT_EXPORT_DATASETS.map((id) => ({
        id,
        ...DATASET_DESCRIPTIONS[id],
        path: id === 'manifest' ? '/api/export/pilot' : `/api/export/pilot/${id}`,
      })),
      payload: {
        schemaVersion: PILOT_EXPORT_SCHEMA_VERSION,
        authentication: [
          'Authorization: Bearer <PILOT_EXPORT_TOKEN>',
          'or national/group owner session cookie (exit rooftop first)',
        ],
        queryParams: {
          limit: '1-500 (paginated datasets)',
          cursor: 'opaque nextCursor from previous page',
          dealershipId: 'optional filter to one rooftop in scope',
          since: 'ISO date — audit/usage/provision/ro_metrics/ai_jobs',
          until: 'ISO date — upper bound',
        },
        rooftopCountInScope: scope.dealershipIds.length,
      },
    };
  }

  // Snapshot datasets need no rooftops
  const needsRooftops = !['platform', 'selfheal', 'health', 'readiness', 'capability', 'manifest'].includes(
    dataset
  );
  if (needsRooftops && scope.dealershipIds.length === 0) {
    return {
      ok: true,
      meta: pageMeta(dataset, input.actor, scope, limit, null, [
        ...notes,
        'No dealerships in scope — provision pilot rooftops or widen token rights.',
      ]),
      data: [],
    };
  }

  return withRlsBypass(async () => {
    const db = getRlsDb();
    const since = input.since ? new Date(input.since) : null;
    const until = input.until ? new Date(input.until) : null;
    const cursor = decodeCursor(input.cursorRaw);

    const createdAtFilter = (field = 'createdAt') => {
      const f: Record<string, unknown> = {};
      if (since && !Number.isNaN(since.getTime())) f.gte = since;
      if (until && !Number.isNaN(until.getTime())) f.lte = until;
      if (cursor) {
        // (createdAt, id) < cursor for desc pagination
        // Prisma: OR createdAt < t OR (createdAt = t AND id < i) with desc
      }
      return Object.keys(f).length ? { [field]: f } : {};
    };

    if (dataset === 'platform') {
      const kv = Boolean(getRateLimitKv());
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [] as unknown[],
        payload: {
          appVersion: getAppVersion() || APP_VERSION,
          buildCommit: getBuildCommit(),
          nodeEnv: process.env.NODE_ENV || null,
          platformMode: process.env.PLATFORM_MODE || process.env.NEXT_PUBLIC_PLATFORM_MODE || null,
          maintenanceMode: isMaintenanceModeEnabled(),
          mfaEnforce: process.env.MERLIN_MFA_ENFORCE?.trim() || null,
          httpProvisionEnabled: process.env.APEX_ALLOW_HTTP_PROVISION === 'true',
          selfHealEnabled: isGrokSelfHealEnabled(),
          maintenanceTimezone: getMaintenanceTimezone(),
          pilotExportEnabled: true,
          bindings: {
            kvStoreVisible: kv,
            objectStorageConfigured: isObjectStorageConfigured(),
            grokKeyConfigured: Boolean(getGrokApiKey()),
            d1Assumed: true,
          },
          rooftopCount: scope.dealershipIds.length,
          schemaVersion: PILOT_EXPORT_SCHEMA_VERSION,
        },
      };
    }

    if (dataset === 'topology') {
      const dealerships = await db.dealership.findMany({
        where: { id: { in: scope.dealershipIds } },
        select: {
          id: true,
          name: true,
          timezone: true,
          storyBrand: true,
          createdAt: true,
          dealerId: true,
          dealer: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              dealerGroupId: true,
              dealerGroup: {
                select: { id: true, code: true, name: true, status: true, timezone: true },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: dealerships.map((d) => ({
          dealershipId: d.id,
          rooftopName: d.name,
          timezone: d.timezone,
          storyBrand: d.storyBrand,
          createdAt: d.createdAt.toISOString(),
          dealer: d.dealer
            ? {
                id: d.dealer.id,
                code: d.dealer.code,
                name: d.dealer.name,
                status: d.dealer.status,
                dealerGroup: d.dealer.dealerGroup
                  ? {
                      id: d.dealer.dealerGroup.id,
                      code: d.dealer.dealerGroup.code,
                      name: d.dealer.dealerGroup.name,
                      status: d.dealer.dealerGroup.status,
                      timezone: d.dealer.dealerGroup.timezone,
                    }
                  : null,
              }
            : null,
        })),
      };
    }

    if (dataset === 'staff') {
      const memberships = await db.technicianDealership.findMany({
        where: {
          dealershipId: { in: scope.dealershipIds },
          isActive: true,
        },
        select: {
          id: true,
          dealershipId: true,
          role: true,
          isPrimary: true,
          isActive: true,
          createdAt: true,
          technician: {
            select: {
              id: true,
              email: true,
              role: true,
              isAdmin: true,
              isActive: true,
              mfaEnabled: true,
              mfaEnrolledAt: true,
              mustChangePassword: true,
              apexUsername: true,
              d7Number: true,
              dealershipId: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor
          ? {
              cursor: { id: cursor.i },
              skip: 1,
            }
          : {}),
      });
      const slice = memberships.slice(0, limit);
      const next =
        memberships.length > limit
          ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id)
          : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, notes),
        data: slice.map((m) => ({
          membershipId: m.id,
          dealershipId: m.dealershipId,
          membershipRole: m.role,
          isPrimary: m.isPrimary,
          technicianId: m.technician.id,
          emailHash: hashEmail(m.technician.email),
          emailDomain: m.technician.email.includes('@')
            ? m.technician.email.split('@')[1]?.toLowerCase()
            : null,
          hasD7: Boolean(m.technician.d7Number),
          hasApexUsername: Boolean(m.technician.apexUsername),
          role: m.technician.role,
          isAdmin: m.technician.isAdmin,
          isActive: m.technician.isActive,
          mfaEnabled: m.technician.mfaEnabled,
          mfaEnrolledAt: m.technician.mfaEnrolledAt?.toISOString() ?? null,
          mustChangePassword: m.technician.mustChangePassword,
          homeDealershipId: m.technician.dealershipId,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }

    if (dataset === 'modules') {
      const rows = await db.dealershipModule.findMany({
        where: { dealershipId: { in: scope.dealershipIds } },
        select: {
          id: true,
          dealershipId: true,
          moduleId: true,
          enabled: true,
          enabledAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ dealershipId: 'asc' }, { moduleId: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.i }, skip: 1 } : {}),
      });
      const slice = rows.slice(0, limit);
      const next =
        rows.length > limit ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id) : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, notes),
        data: slice.map((r) => ({
          id: r.id,
          dealershipId: r.dealershipId,
          moduleId: r.moduleId,
          enabled: r.enabled,
          enabledAt: r.enabledAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }

    if (dataset === 'usage') {
      const rows = await db.usageEvent.findMany({
        where: {
          dealershipId: { in: scope.dealershipIds },
          ...createdAtFilter(),
        },
        select: {
          id: true,
          dealershipId: true,
          dealerId: true,
          repairOrderId: true,
          repairLineId: true,
          eventType: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.i }, skip: 1 } : {}),
      });
      const slice = rows.slice(0, limit);
      const next =
        rows.length > limit
          ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id)
          : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, notes),
        data: slice.map((r) => ({
          id: r.id,
          dealershipId: r.dealershipId,
          dealerId: r.dealerId,
          repairOrderId: r.repairOrderId,
          repairLineId: r.repairLineId,
          eventType: r.eventType,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (dataset === 'audit' || dataset === 'provision') {
      const rows = await db.auditLog.findMany({
        where: {
          dealershipId: {
            in:
              dataset === 'provision'
                ? [...scope.dealershipIds, APEX_NATIONAL_DEALERSHIP_ID]
                : scope.dealershipIds,
          },
          ...(dataset === 'provision' ? { action: 'dealer.provision' } : {}),
          ...createdAtFilter(),
        },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          technicianId: true,
          dealerId: true,
          dealershipId: true,
          metadata: true,
          ipAddress: true,
          promptVersion: true,
          previousHash: true,
          entryHash: true,
          authSource: true,
          scopeMode: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.i }, skip: 1 } : {}),
      });
      const slice = rows.slice(0, limit);
      const next =
        rows.length > limit
          ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id)
          : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, notes),
        data: slice.map((r) => ({
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          technicianId: r.technicianId,
          dealerId: r.dealerId,
          dealershipId: r.dealershipId,
          metadata: scrubMetadata(r.metadata),
          ipAddress: maskIp(r.ipAddress),
          promptVersion: r.promptVersion,
          previousHash: r.previousHash,
          entryHash: r.entryHash,
          authSource: r.authSource,
          scopeMode: r.scopeMode,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (dataset === 'ro_metrics') {
      const rows = await db.repairOrder.findMany({
        where: {
          dealershipId: { in: scope.dealershipIds },
          ...createdAtFilter(),
        },
        select: {
          id: true,
          dealershipId: true,
          dealerId: true,
          technicianId: true,
          year: true,
          make: true,
          model: true,
          createdAt: true,
          updatedAt: true,
          repairLines: {
            select: {
              id: true,
              storyGenerated: true,
              storyCertifiedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.i }, skip: 1 } : {}),
      });
      const slice = rows.slice(0, limit);
      const next =
        rows.length > limit
          ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id)
          : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, [
          ...notes,
          'Vehicle year/make/model only — no VIN/customer/RO number/story text.',
        ]),
        data: slice.map((ro) => ({
          repairOrderId: ro.id,
          dealershipId: ro.dealershipId,
          dealerId: ro.dealerId,
          technicianId: ro.technicianId,
          vehicle: { year: ro.year, make: ro.make, model: ro.model },
          lineCount: ro.repairLines.length,
          storiesGenerated: ro.repairLines.filter((l) => l.storyGenerated).length,
          storiesCertified: ro.repairLines.filter((l) => l.storyCertifiedAt).length,
          lineIds: ro.repairLines.map((l) => ({
            id: l.id,
            storyGenerated: l.storyGenerated,
            certifiedAt: l.storyCertifiedAt?.toISOString() ?? null,
          })),
          createdAt: ro.createdAt.toISOString(),
          updatedAt: ro.updatedAt.toISOString(),
        })),
      };
    }

    if (dataset === 'ai_jobs') {
      // AiJob model may use different field names — probe via prisma
      const rows = await db.aiJob.findMany({
        where: {
          dealershipId: { in: scope.dealershipIds },
          ...createdAtFilter(),
        },
        select: {
          id: true,
          dealershipId: true,
          technicianId: true,
          kind: true,
          status: true,
          progress: true,
          entityType: true,
          entityId: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.i }, skip: 1 } : {}),
      });
      const slice = rows.slice(0, limit);
      const next =
        rows.length > limit
          ? encodeCursor(slice[slice.length - 1]!.createdAt, slice[slice.length - 1]!.id)
          : null;
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, next, notes),
        data: slice.map((j) => ({
          id: j.id,
          dealershipId: j.dealershipId,
          technicianId: j.technicianId,
          kind: j.kind,
          status: j.status,
          progress: j.progress,
          entityType: j.entityType,
          entityId: j.entityId,
          errorMessage: j.errorMessage ? String(j.errorMessage).slice(0, 200) : null,
          startedAt: j.startedAt?.toISOString() ?? null,
          finishedAt: j.finishedAt?.toISOString() ?? null,
          createdAt: j.createdAt.toISOString(),
          updatedAt: j.updatedAt.toISOString(),
        })),
      };
    }

    if (dataset === 'billing') {
      if (input.actor.mode === 'service_token' || !input.actor.technicianId) {
        // Aggregate usage counts without owner session context
        const groups = await db.usageEvent.groupBy({
          by: ['dealershipId', 'eventType'],
          where: { dealershipId: { in: scope.dealershipIds } },
          _count: { _all: true },
        });
        return {
          ok: true as const,
          meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
          data: groups.map((g) => ({
            dealershipId: g.dealershipId,
            eventType: g.eventType,
            count: g._count._all,
          })),
          payload: {
            note: 'Service-token billing export is raw UsageEvent counts. Owner session returns full estimate summary.',
          },
        };
      }
      const summary = await getOwnerBillingSummary({
        technicianId: input.actor.technicianId,
      });
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [],
        payload: summary as unknown as Record<string, unknown>,
      };
    }

    if (dataset === 'selfheal') {
      const [nightly, morning, windowState] = await Promise.all([
        loadLatestNightlyReport(),
        loadLatestMorningReport(),
        loadWindowState(),
      ]);
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [],
        payload: { nightly, morning, windowState },
      };
    }

    if (dataset === 'health') {
      const checks = await runAuthenticatedHealthChecks({ dealershipId: null });
      const overall = aggregateAuthenticatedHealthStatus(checks);
      const services = buildHealthServicesPayload(checks);
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [],
        payload: { overall, services },
      };
    }

    if (dataset === 'readiness') {
      const readiness = await evaluatePlatformReadiness();
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [],
        payload: readiness as unknown as Record<string, unknown>,
      };
    }

    if (dataset === 'capability') {
      const jsonPath = join(process.cwd(), 'docs/generated/capability-matrix.json');
      let matrix: unknown = null;
      if (existsSync(jsonPath)) {
        try {
          matrix = JSON.parse(readFileSync(jsonPath, 'utf8'));
        } catch {
          matrix = { error: 'parse_failed' };
        }
      }
      return {
        ok: true as const,
        meta: pageMeta(dataset, input.actor, scope, limit, null, notes),
        data: [],
        payload: {
          available: Boolean(matrix),
          matrix,
        },
      };
    }

    return {
      ok: false as const,
      status: 400,
      code: 'UNHANDLED_DATASET',
      error: `Dataset ${dataset} is not implemented`,
    };
  });
}
