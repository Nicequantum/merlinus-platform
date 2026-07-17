/** Whether a service advisor is visible in active management lists and eligible for RO linking. */
export function isServiceAdvisorActive(advisor: {
  status: string;
  deletedAt: Date | string | null | undefined;
}): boolean {
  return advisor.status === 'active' && advisor.deletedAt == null;
}