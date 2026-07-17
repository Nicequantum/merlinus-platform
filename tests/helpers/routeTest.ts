import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '../../src/lib/auth';

export function buildAuthenticatedRequest(
  url: string,
  token: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  const headers = new Headers({
    Cookie: `${SESSION_COOKIE}=${token}`,
  });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  return new NextRequest(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function readJsonResponse<T>(response: Response): Promise<{ status: number; body: T }> {
  const body = (await response.json()) as T;
  return { status: response.status, body };
}