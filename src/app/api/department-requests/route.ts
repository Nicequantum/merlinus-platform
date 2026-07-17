import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import {
  assertDepartmentInboxAccess,
  departmentRequestInclude,
} from '@/lib/department/access';
import {
  DEPARTMENT_REQUEST_PRIORITIES,
  DEPARTMENT_REQUEST_SOURCES,
  DEPARTMENT_REQUEST_STATUSES,
  isDepartmentId,
  type DepartmentId,
} from '@/lib/department/constants';
import {
  last8OfVin,
  mapDepartmentRequestDetail,
  mapDepartmentRequestSummary,
  phoneLast4,
} from '@/lib/department/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const listQuerySchema = z.object({
  department: z.string().trim().min(1).max(32),
  status: z.string().trim().max(32).optional(),
});

const createSchema = z.object({
  department: z.string().trim().min(1).max(32),
  subject: z.string().trim().min(1).max(200),
  summary: z.string().max(8000).optional(),
  priority: z.enum(DEPARTMENT_REQUEST_PRIORITIES).optional(),
  source: z.enum(DEPARTMENT_REQUEST_SOURCES).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  customerEmail: z.string().max(200).optional(),
  vin: z.string().max(32).optional(),
  vehicleLabel: z.string().max(200).optional(),
  stockOrRoHint: z.string().max(120).optional(),
  assignedToId: z.string().max(64).optional(),
  partsLines: z
    .array(
      z.object({
        partNumber: z.string().max(64).optional(),
        description: z.string().trim().min(1).max(300),
        qty: z.number().int().min(1).max(999).optional(),
        status: z.string().max(32).optional(),
        vendor: z.string().max(120).optional(),
        notes: z.string().max(2000).optional(),
      })
    )
    .max(40)
    .optional(),
});

function moduleForDepartment(department: DepartmentId): 'parts' | null {
  if (department === 'parts') return 'parts';
  // Future departments map to their module ids here
  return null;
}

/**
 * PR-M2 — list department requests for a rooftop inbox.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedQuery = listQuerySchema.safeParse({
    department: url.searchParams.get('department') || '',
    status: url.searchParams.get('status') || undefined,
  });
  if (!parsedQuery.success) {
    return apiError('department query param is required', 400);
  }
  if (!isDepartmentId(parsedQuery.data.department)) {
    return apiError('Invalid department', 400);
  }
  const department = parsedQuery.data.department;
  const moduleId = moduleForDepartment(department);
  if (!moduleId) {
    return apiError('Department module not available yet', 400);
  }

  return withAuth(
    request,
    async (session) => {
      const access = assertDepartmentInboxAccess(session, department);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const status = parsedQuery.data.status?.trim();
      const rows = await getRlsDb().departmentRequest.findMany({
        where: {
          dealershipId: session.dealershipId,
          department,
          ...(status && (DEPARTMENT_REQUEST_STATUSES as readonly string[]).includes(status)
            ? { status }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          createdBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
          partsLines: { select: { id: true } },
        },
      });

      return {
        department,
        requests: rows.map((row) =>
          mapDepartmentRequestSummary({
            ...row,
            partsLines: row.partsLines.map((l) => ({
              id: l.id,
              partNumber: null,
              description: '',
              qty: 0,
              status: 'requested',
              quotedPriceCents: null,
              vendor: null,
              notesEncrypted: '',
              sortOrder: 0,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })),
          })
        ),
      };
    },
    {
      rateLimitKey: 'department.list',
      requireDealershipContext: true,
      requireModule: moduleId,
    }
  );
}

/**
 * PR-M2 — create a department request (manual Parts entry first).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;
      if (!isDepartmentId(parsed.data.department)) {
        return apiError('Invalid department', 400);
      }
      const department = parsed.data.department;
      const moduleId = moduleForDepartment(department);
      if (!moduleId) return apiError('Department module not available yet', 400);

      // Module check is also on withAuth below — double-check access role here
      const access = assertDepartmentInboxAccess(session, department);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const dealerId = resolveDealerIdForWrite({ session });
      const vin = (parsed.data.vin || '').trim().toUpperCase();
      const phone = (parsed.data.customerPhone || '').trim();
      const lines = parsed.data.partsLines || [];

      const row = await getRlsDb().departmentRequest.create({
        data: {
          dealershipId: session.dealershipId,
          dealerId: dealerId ?? null,
          department,
          source: parsed.data.source || 'manual',
          status: 'new',
          priority: parsed.data.priority || 'normal',
          subject: parsed.data.subject.trim(),
          summaryEncrypted: encryptSensitiveText(parsed.data.summary?.trim() || ''),
          customerNameEncrypted: encryptSensitiveText(parsed.data.customerName?.trim() || ''),
          customerPhoneEncrypted: encryptSensitiveText(phone),
          customerPhoneLast4: phoneLast4(phone),
          customerEmailEncrypted: encryptSensitiveText(parsed.data.customerEmail?.trim() || ''),
          vinEncrypted: encryptSensitiveText(vin),
          vinLast8: last8OfVin(vin),
          vehicleLabel: parsed.data.vehicleLabel?.trim() || null,
          stockOrRoHint: parsed.data.stockOrRoHint?.trim() || null,
          createdById: session.technicianId,
          assignedToId: parsed.data.assignedToId?.trim() || null,
          partsLines:
            department === 'parts' && lines.length > 0
              ? {
                  create: lines.map((line, i) => ({
                    partNumber: line.partNumber?.trim() || null,
                    description: line.description.trim(),
                    qty: line.qty ?? 1,
                    status: line.status || 'requested',
                    vendor: line.vendor?.trim() || null,
                    notesEncrypted: encryptSensitiveText(line.notes?.trim() || ''),
                    sortOrder: i,
                  })),
                }
              : undefined,
        },
        include: departmentRequestInclude,
      });

      return { request: mapDepartmentRequestDetail(row) };
    },
    {
      rateLimitKey: 'department.create',
      requireDealershipContext: true,
      // Module enforced after body parse via dynamic module — use parts for now when body has parts.
      // withAuth requireModule is static; we enforce module in-handler for create after parse,
      // but still set parts as default gate for first department.
      requireModule: 'parts',
    }
  );
}
