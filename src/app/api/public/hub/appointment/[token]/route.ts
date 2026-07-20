import { createHash } from 'crypto';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { decryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { HUB_CATEGORY_LABELS, HUB_STATUS_LABELS } from '@/lib/hub/constants';

/**
 * Customer-facing appointment portal (share token).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimited = await checkRateLimit(request, 'hub.public_appointment', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  const { token } = await params;
  const raw = token?.trim();
  if (!raw || raw.length < 16 || raw.length > 80) return apiError(NOT_FOUND_ERROR, 404);

  const tokenHash = createHash('sha256').update(raw).digest('hex');

  const row = await withRlsBypass(async () =>
    getRlsDb().serviceAppointment.findFirst({
      where: { shareTokenHash: tokenHash },
      include: { dealership: { select: { name: true } } },
    })
  );

  if (!row) return apiError(NOT_FOUND_ERROR, 404);
  if (row.shareExpiresAt && row.shareExpiresAt.getTime() < Date.now()) {
    return apiError('This appointment link has expired.', 410);
  }

  return Response.json({
    dealershipName: row.dealership.name,
    title: row.title,
    categoryLabel: HUB_CATEGORY_LABELS[row.category as keyof typeof HUB_CATEGORY_LABELS] || row.category,
    statusLabel: HUB_STATUS_LABELS[row.status as keyof typeof HUB_STATUS_LABELS] || row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    vehicleLabel: row.vehicleLabel,
    advisorName: row.advisorName,
    customerName: decryptSensitiveText(row.customerNameEncrypted || '') || null,
    notes: decryptSensitiveText(row.notesEncrypted || '') || null,
  });
}
