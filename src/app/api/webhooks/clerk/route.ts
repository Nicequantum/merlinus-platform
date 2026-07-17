/**
 * Clerk identity webhook — public route secured by Svix signature verification (not withAuth).
 * Registered in MERLIN_PUBLIC_ROUTE_PATTERNS; pre-rollout audit accepts verifyWebhook().
 */
import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { NextResponse, type NextRequest } from 'next/server';
import { clerkEnvConfigured } from '@/lib/authMode';
import { handleClerkWebhookUserEvent } from '@/lib/clerkIdentity';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  if (!clerkEnvConfigured()) {
    return NextResponse.json({ error: 'Clerk is not configured' }, { status: 503 });
  }

  try {
    const event = await verifyWebhook(request);
    const eventType = event.type;

    if (eventType === 'user.deleted') {
      const clerkUserId = 'deleted' in event.data ? event.data.id : undefined;
      if (clerkUserId) {
        await handleClerkWebhookUserEvent(eventType, { id: clerkUserId });
      }
    } else if (eventType === 'user.created' || eventType === 'user.updated') {
      await handleClerkWebhookUserEvent(eventType, event.data);
      logger.info('auth.clerk_webhook_processed', {
        eventType,
        clerkUserId: event.data.id,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.warn('auth.clerk_webhook_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Webhook verification failed' }, { status: 400 });
  }
}