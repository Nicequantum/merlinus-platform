import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { isSmsEnabled, normalizeE164, sendSms } from '@/lib/sms/twilio';
import { findInspectionForSession } from '@/lib/videoInspection/access';
import {
  buildCustomerViewerUrl,
  generateShareToken,
  hashShareToken,
} from '@/lib/videoInspection/shareTokens';
import { buildVideoInspectionSmsBody } from '@/lib/videoInspection/smsBody';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

export { buildVideoInspectionSmsBody };

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });
/** Phone only — share URLs are always server-minted (no client shareUrl). */
const bodySchema = z.object({
  phone: z.string().trim().min(7).max(32),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findInspectionForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      if (!existing.videoPathname?.trim()) {
        return apiError('Upload a video before sending a customer link.', 400);
      }

      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const phone = normalizeE164(parsed.data.phone);
      if (!phone) return apiError('Enter a valid mobile number (US 10-digit or E.164).', 400);

      // Always mint a fresh share on the server — never trust a client URL (anti-phishing).
      const token = generateShareToken();
      const share = await getRlsDb().videoInspectionShare.create({
        data: {
          videoInspectionId: existing.id,
          tokenHash: hashShareToken(token),
          expiresAt: new Date(Date.now() + 14 * 24 * 3600_000),
          createdByTechnicianId: session.technicianId,
        },
      });
      const shareUrl = buildCustomerViewerUrl(token, request);
      const report = decryptSensitiveText(existing.reportEncrypted || '');
      const dealershipRaw =
        existing.dealership?.name || session.dealershipName || 'Your service team';
      const smsBody = buildVideoInspectionSmsBody({
        dealershipName: dealershipRaw,
        shareUrl,
        report,
        vehicleLabel: existing.vehicleLabel,
      });

      if (!isSmsEnabled()) {
        // Still return production share link so staff can copy/send manually
        return {
          ok: false,
          smsSent: false,
          shareUrl,
          phoneLast4: phone.slice(-4),
          error:
            'SMS is not configured on this server (set SMS_ENABLED=true and Twilio credentials). Customer link is ready to copy.',
        };
      }

      try {
        const { sid } = await sendSms(phone, smsBody);
        await getRlsDb().videoInspectionSmsLog.create({
          data: {
            videoInspectionId: existing.id,
            shareId: share.id,
            phoneEncrypted: encryptSensitiveText(phone),
            phoneLast4: phone.slice(-4),
            providerMessageId: sid,
            status: 'sent',
            sentByTechnicianId: session.technicianId,
          },
        });
        await getRlsDb().videoInspection.update({
          where: { id: existing.id },
          data: {
            status: existing.status === 'ready' || existing.status === 'draft' ? 'sent' : existing.status,
            deliveryChannel: 'sms',
            deliveredAt: new Date(),
          },
        });

        await writeAuditedAccess({
          action: 'video.sms_send',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'video_inspection',
          entityId: existing.id,
          metadata: {
            phoneLast4: phone.slice(-4),
            providerMessageId: sid,
            shareId: share.id,
            shareUrlHost: (() => {
              try {
                return new URL(shareUrl).host;
              } catch {
                return 'unknown';
              }
            })(),
            bodyChars: smsBody.length,
          },
          ipAddress: getRequestIp(request),
        });

        return { ok: true, smsSent: true, shareUrl, phoneLast4: phone.slice(-4) };
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'SMS send failed', 502);
      }
    },
    {
      rateLimitKey: 'video.sms',
      rateLimit: RATE_LIMITS.sms,
      requireDealershipContext: true,
      requireModule: 'video_mpi',
    }
  );
}
