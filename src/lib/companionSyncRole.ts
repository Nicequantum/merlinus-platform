export type CompanionSyncRole = 'publisher' | 'subscriber' | 'full';

/** Narrow viewport = tablet (publishes). Wide viewport = desktop companion (subscribes). */
export function deriveCompanionSyncRole(isDesktopViewport: boolean): CompanionSyncRole {
  return isDesktopViewport ? 'subscriber' : 'publisher';
}

export function companionRolePublishes(role: CompanionSyncRole): boolean {
  return role === 'publisher' || role === 'full';
}

export function companionRoleSubscribes(role: CompanionSyncRole): boolean {
  return role === 'subscriber' || role === 'full';
}