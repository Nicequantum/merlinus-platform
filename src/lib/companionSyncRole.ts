export type CompanionSyncRole = 'publisher' | 'subscriber' | 'full';

/**
 * Narrow viewport = bay tablet (primary publisher).
 * Wide viewport = desktop command center (`full`: publish local edits + subscribe to bay live).
 */
export function deriveCompanionSyncRole(isDesktopViewport: boolean): CompanionSyncRole {
  return isDesktopViewport ? 'full' : 'publisher';
}

export function companionRolePublishes(role: CompanionSyncRole): boolean {
  return role === 'publisher' || role === 'full';
}

export function companionRoleSubscribes(role: CompanionSyncRole): boolean {
  return role === 'subscriber' || role === 'full';
}