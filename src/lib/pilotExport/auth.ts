import 'server-only';

import { timingSafeEqual } from 'crypto';
import { resolveAppSession } from '@/lib/authBridge';
import { canAccessNationalConsole } from '@/lib/apex/tenantScope';
import { isApexPlatformMode } from '@/lib/platformMode';
import type { PilotExportActor } from '@/lib/pilotExport/types';

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const n = v.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes';
}

export function isPilotExportEnabled(): boolean {
  if (process.env.PILOT_EXPORT_ENABLED !== undefined) {
    return isTruthy(process.env.PILOT_EXPORT_ENABLED);
  }
  return process.env.NODE_ENV !== 'production';
}

export function getPilotExportToken(): string | null {
  const t =
    process.env.PILOT_EXPORT_TOKEN?.trim() || process.env.PILOT_EXPORT_SECRET?.trim() || '';
  return t.length >= 24 ? t : null;
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function extractBearer(request: Request): string | null {
  const auth = request.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null;
  }
  return request.headers.get('x-pilot-export-token')?.trim() || null;
}

export type PilotExportAuthResult =
  | { ok: true; actor: PilotExportActor }
  | { ok: false; status: number; code: string; error: string };

/**
 * Dual auth:
 * 1) Service token (GCP migration team) — PILOT_EXPORT_TOKEN
 * 2) National/group owner session cookie
 */
export async function authorizePilotExport(request: Request): Promise<PilotExportAuthResult> {
  if (!isApexPlatformMode()) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_APEX',
      error: 'Pilot export is only available in apex platform mode.',
    };
  }

  if (!isPilotExportEnabled()) {
    return {
      ok: false,
      status: 403,
      code: 'EXPORT_DISABLED',
      error: 'Pilot export is disabled. Set PILOT_EXPORT_ENABLED=true on the Worker.',
    };
  }

  const bearer = extractBearer(request);
  const expected = getPilotExportToken();
  if (bearer && expected && safeEqual(bearer, expected)) {
    return {
      ok: true,
      actor: {
        mode: 'service_token',
        technicianId: null,
        label: 'migration-service-token',
      },
    };
  }

  try {
    const session = await resolveAppSession(request);
    if (!session) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: bearer
          ? 'Invalid pilot export token.'
          : 'Authentication required (owner session or Bearer PILOT_EXPORT_TOKEN).',
      };
    }
    if (!session.isOwner && session.role !== 'owner') {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        error: 'Only national owners or the migration service token may export pilot data.',
      };
    }
    if (!canAccessNationalConsole(session)) {
      return {
        ok: false,
        status: 403,
        code: 'DEALERSHIP_CONTEXT_REQUIRED',
        error: 'Exit dealership context before exporting (national/group home required).',
      };
    }

    return {
      ok: true,
      actor: {
        mode: 'owner_session',
        technicianId: session.technicianId,
        label: session.technicianId,
      },
    };
  } catch {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      error: 'Authentication required.',
    };
  }
}
