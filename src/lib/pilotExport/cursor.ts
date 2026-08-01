/** Opaque cursor: base64url(JSON({ t: iso, i: id })) */

export function encodeCursor(createdAt: Date | string, id: string): string {
  const t = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  const raw = JSON.stringify({ t, i: id });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): { t: string; i: string } | null {
  if (!cursor?.trim()) return null;
  try {
    const raw = Buffer.from(cursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { t?: string; i?: string };
    if (!parsed.t || !parsed.i) return null;
    return { t: parsed.t, i: parsed.i };
  } catch {
    return null;
  }
}

export function clampLimit(raw: string | null, fallback = 100, max = 500): number {
  const n = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}
