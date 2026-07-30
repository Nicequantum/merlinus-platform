export type CompanionSyncRole = 'publisher' | 'subscriber' | 'full';

/**
 * Every signed-in device is full-duplex: publish local edits and subscribe to peers.
 * Viewport only changes layout (desktop command center chrome), not sync capability —
 * tablet ↔ phone ↔ desktop must all stay live for the same account.
 */
export function deriveCompanionSyncRole(_isDesktopViewport: boolean): CompanionSyncRole {
  return 'full';
}

export function companionRolePublishes(role: CompanionSyncRole): boolean {
  return role === 'publisher' || role === 'full';
}

export function companionRoleSubscribes(role: CompanionSyncRole): boolean {
  return role === 'subscriber' || role === 'full';
}
