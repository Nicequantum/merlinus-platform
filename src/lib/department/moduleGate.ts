/**
 * Server-side department module checks (PR-M8).
 */

import 'server-only';

import { isModuleEnabled } from '@/lib/modules/entitlements';
import {
  moduleForDepartment,
  type DepartmentId,
} from '@/lib/department/constants';

export async function assertDepartmentModuleEnabled(
  dealershipId: string,
  department: DepartmentId
): Promise<{ ok: true } | { ok: false; message: string }> {
  const moduleId = moduleForDepartment(department);
  if (!moduleId) {
    return { ok: false, message: 'Department module not available' };
  }
  const enabled = await isModuleEnabled(dealershipId, moduleId);
  if (!enabled) {
    return {
      ok: false,
      message: `Module "${moduleId}" is not enabled for this dealership`,
    };
  }
  return { ok: true };
}
