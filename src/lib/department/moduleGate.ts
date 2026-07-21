/**
 * Server-side department module checks (PR-M8 / P2-6).
 * Returns the same MODULE_DISABLED code shape as withAuth requireModule.
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { ModuleDisabledError, isModuleEnabled } from '@/lib/modules/entitlements';
import {
  moduleForDepartment,
  type DepartmentId,
} from '@/lib/department/constants';

export type DepartmentModuleGateResult =
  | { ok: true; moduleId: string }
  | {
      ok: false;
      message: string;
      code: 'MODULE_DISABLED' | 'MODULE_UNAVAILABLE';
      moduleId?: string;
    };

export async function assertDepartmentModuleEnabled(
  dealershipId: string,
  department: DepartmentId
): Promise<DepartmentModuleGateResult> {
  const moduleId = moduleForDepartment(department);
  if (!moduleId) {
    return {
      ok: false,
      code: 'MODULE_UNAVAILABLE',
      message: 'Department module not available',
    };
  }
  const enabled = await isModuleEnabled(dealershipId, moduleId);
  if (!enabled) {
    const err = new ModuleDisabledError(moduleId);
    return {
      ok: false,
      code: err.code,
      moduleId: err.moduleId,
      message: err.message,
    };
  }
  return { ok: true, moduleId };
}

/** JSON 403 matching withAuth requireModule MODULE_DISABLED payload. */
export function departmentModuleDisabledResponse(
  gate: Extract<DepartmentModuleGateResult, { ok: false }>
): NextResponse {
  const status = 403;
  if (gate.code === 'MODULE_DISABLED') {
    return NextResponse.json(
      {
        error: gate.message,
        code: gate.code,
        moduleId: gate.moduleId,
      },
      { status }
    );
  }
  return NextResponse.json(
    { error: gate.message, code: gate.code },
    { status }
  );
}
