import { createHash, randomBytes } from 'crypto';

export function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}
