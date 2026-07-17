import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/apiRoute';
import { blockServiceAdvisorAi } from '@/lib/roleGuards';
import {
  getGrokProxyUpstreamApiKey,
  isGrokProxyConfigured,
} from '@/lib/grokApiKey.shared';
import { isValidGrokProxyBearer } from '@/lib/grokProxyAuth';
import { logger } from '@/lib/logger';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseGrokApiErrorBody } from '@/lib/scanRouteErrors';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const MAX_PROXY_BODY_BYTES = 2_000_000;

async function handleGrokProxyForward(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
  }

  try {
    const upstreamKey = getGrokProxyUpstreamApiKey();
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstreamKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    if (!response.ok) {
      const detail = parseGrokApiErrorBody(responseText);
      logger.warn('grok.proxy.upstream_error', {
        status: response.status,
        detail: detail || undefined,
      });
      return NextResponse.json(
        { error: `Upstream Grok API error: ${response.status}${detail ? ` — ${detail}` : ''}` },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    try {
      return NextResponse.json(JSON.parse(responseText));
    } catch {
      return NextResponse.json({ error: 'Upstream Grok API returned invalid JSON' }, { status: 502 });
    }
  } catch (error) {
    logger.error('grok.proxy.forward_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Grok proxy forward failed' }, { status: 502 });
  }
}

/**
 * Apex national platform — centralized Grok proxy endpoint.
 *
 * Dealer nodes authenticate with short-lived HMAC tokens minted via
 * createGrokProxyAccessToken() (signed with GROK_PROXY_API_KEY).
 * Static bearer keys require GROK_PROXY_ALLOW_STATIC_BEARER=true (break-glass).
 *
 * Session-authenticated app users may also call this route (usage tracked).
 */
export async function POST(request: Request) {
  if (!isGrokProxyConfigured()) {
    return NextResponse.json({ error: 'Grok proxy is not configured on this host' }, { status: 503 });
  }

  // Rate-limit machine tokens before any expensive work (session path has its own limit).
  if (isValidGrokProxyBearer(request)) {
    const rateLimited = await checkRateLimit(request, 'grok.proxy.bearer', RATE_LIMITS.grok);
    if (rateLimited) return rateLimited;
    return handleGrokProxyForward(request);
  }

  return withAuth(
    request,
    async (session) => {
      const blocked = blockServiceAdvisorAi(session);
      if (blocked) return blocked;

      return handleGrokProxyForward(request);
    },
    {
      rateLimitKey: 'grok.proxy',
      rateLimit: RATE_LIMITS.grok,
      trackUsage: true,
      blockInMaintenance: true,
      requireDealershipContext: true,
      perfEvent: 'api.grok.proxy',
    }
  );
}
