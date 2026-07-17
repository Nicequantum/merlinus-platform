import 'server-only';

import { createHash } from 'crypto';
import { sanitizeForCDK } from './sanitizeForCDK';

/** SHA-256 of CDK-sanitized story text — binds certification to exact on-screen content. */
export function hashWarrantyStory(story: string): string {
  const normalized = sanitizeForCDK(story.trim());
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}