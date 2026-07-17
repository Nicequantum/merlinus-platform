import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  assertDepartmentInboxAccess,
  departmentRequestInclude,
  findDepartmentRequestForSession,
} from '@/lib/department/access';
import {
  DEPARTMENT_REQUEST_PRIORITIES,
  DEPARTMENT_REQUEST_STATUSES,
  isDepartmentId,
  type DepartmentId,
} from '@/lib/department/constants';
import {
  last8OfVin,
  mapDepartmentRequestDetail,
  phoneLast4,
} from '@/lib/department/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(8000).optional(),
  status: z.enum(DEPARTMENT_REQUEST_STATUSES).optional(),
  priority: z.enum(DEPARTMENT_REQUEST_PRIORITIES).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  customerEmail: z.string().max(200).optional(),
  vin: z.string().max(32).optional(),
  vehicleLabel: z.string().max(200).nullable().optional(),
  stockOrRoHint: z.string().max(120).nullable().optional(),
  assignedToId: z.string().max(64).nullable().optional(),
});

function moduleForDepartment(department: string): 'parts' | null {
  if (department === 'parts') return 'parts';
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const row = await findDepartmentRequestForSession(session, routeParams.data.id);
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      if (!isDepartmentId(row.department)) return apiError(NOT_FOUND_ERROR, 404);
      const access = assertDepartmentInboxAccess(session, row.department);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);
      return { request: mapDepartmentRequestDetail(row) };
    },
    {
      rateLimitKey: 'department.get',
      requireDealershipContext: true,
      requireModule: 'parts',
    }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findDepartmentRequestForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      if (!isDepartmentId(existing.department)) return apiError(NOT_FOUND_ERROR, 404);
      const access = assertDepartmentInboxAccess(session, existing.department as DepartmentId);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const moduleId = moduleForDepartment(existing.department);
      if (!moduleId) return apiError('Department module not available yet', 400);

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data: Record<string, unknown> = {};
      if (parsed.data.subject !== undefined) data.subject = parsed.data.subject;
      if (parsed.data.summary !== undefined) {
        data.summaryEncrypted = encryptSensitiveText(parsed.data.summary);
      }
      if (parsed.data.status !== undefined) data.status = parsed.data.status;
      if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
      if (parsed.data.customerName !== undefined) {
        data.customerNameEncrypted = encryptSensitiveText(parsed.data.customerName.trim());
      }
      if (parsed.data.customerPhone !== undefined) {
        const phone = parsed.data.customerPhone.trim();
        data.customerPhoneEncrypted = encryptSensitiveText(phone);
        data.customerPhoneLast4 = phoneLast4(phone);
      }
      if (parsed.data.customerEmail !== undefined) {
        data.customerEmailEncrypted = encryptSensitiveText(parsed.data.customerEmail.trim());
      }
      if (parsed.data.vin !== undefined) {
        const vin = parsed.data.vin.trim().toUpperCase();
        data.vinEncrypted = encryptSensitiveText(vin);
        data.vinLast8 = last8OfVin(vin);
      }
      if (parsed.data.vehicleLabel !== undefined) data.vehicleLabel = parsed.data.vehicleLabel;
      if (parsed.data.stockOrRoHint !== undefined) data.stockOrRoHint = parsed.data.stockOrRoHint;
      if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;

      const row = await getRlsDb().departmentRequest.update({
        where: { id: existing.id },
        data,
        include: departmentRequestInclude,
      });

      return { request: mapDepartmentRequestDetail(row) };
    },
    {
      rateLimitKey: 'department.patch',
      requireDealershipContext: true,
      requireModule: 'parts',
    }
  );
}
