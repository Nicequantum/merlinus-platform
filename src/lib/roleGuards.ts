import { apiError, FORBIDDEN_ERROR } from './errors';
import { effectiveRole, type ViewAsSessionFields } from '@/lib/apex/viewAs';

type SessionRole = ViewAsSessionFields;

/** Service advisors may view ROs but must not invoke Grok-backed extraction or story AI. */
export function blockServiceAdvisorAi(session: SessionRole) {
  if (effectiveRole(session) === 'service_advisor') {
    return apiError(FORBIDDEN_ERROR, 403);
  }
  return null;
}
