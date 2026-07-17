import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { uploadImageToBlob } from '@/lib/blob';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR, reportMappedRouteError } from '@/lib/errors';
import { mapBlobRouteError } from '@/lib/scanRouteErrors';
import {
  assertCanSubmitMaintenance,
  findMaintenanceTicketForSession,
  maintenanceTicketInclude,
} from '@/lib/maintenance/access';
import { mapMaintenanceTicketDetail } from '@/lib/maintenance/mappers';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

type UploadFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function isUploadFile(value: unknown): value is UploadFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof (value as UploadFile).arrayBuffer === 'function' &&
    'name' in value &&
    'type' in value &&
    'size' in value
  );
}

/**
 * PR-M3 — attach photos to a maintenance ticket (multipart).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const submit = assertCanSubmitMaintenance(session);
      if (!submit.ok) return apiError(submit.message || FORBIDDEN_ERROR, 403);

      const existing = await findMaintenanceTicketForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return apiError('Invalid multipart body', 400);
      }

      const files: UploadFile[] = [];
      for (const entry of form.getAll('photos')) {
        if (isUploadFile(entry)) files.push(entry);
        if (files.length >= 6) break;
      }
      if (files.length === 0) return apiError('At least one photo is required', 400);

      const created: string[] = [];
      for (const file of files) {
        if (!ALLOWED.has(file.type) && !file.name.match(/\.(jpe?g|png|webp)$/i)) continue;
        if (file.size > 5 * 1024 * 1024) continue;
        try {
          const uploaded = await uploadImageToBlob(
            Buffer.from(await file.arrayBuffer()),
            file.name || 'maintenance.jpg',
            file.type || 'image/jpeg'
          );
          await getRlsDb().maintenancePhoto.create({
            data: {
              ticketId: existing.id,
              pathname: uploaded.pathname,
              contentType: file.type || 'image/jpeg',
            },
          });
          created.push(uploaded.pathname);
        } catch (error) {
          const mapped = mapBlobRouteError(error, 'upload');
          return reportMappedRouteError(mapped, error, 'maintenance.photo');
        }
      }

      if (created.length > 0) {
        await getRlsDb().maintenanceTicketEvent.create({
          data: {
            ticketId: existing.id,
            actorId: session.technicianId,
            type: 'comment',
            payloadEncrypted: encryptSensitiveText(
              JSON.stringify({ photosAdded: created.length })
            ),
          },
        });
      }

      const row = await getRlsDb().maintenanceTicket.findFirst({
        where: { id: existing.id },
        include: maintenanceTicketInclude,
      });
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { ticket: mapMaintenanceTicketDetail(row), photosAdded: created.length };
    },
    {
      rateLimitKey: 'maintenance.photos',
      requireDealershipContext: true,
      requireModule: 'maintenance',
    }
  );
}

export const maxDuration = 60;
