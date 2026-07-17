/** Technician is available for login and active account management. */
export function isTechnicianAccountActive(tech: {
  isActive: boolean;
  deletedAt: Date | string | null | undefined;
}): boolean {
  return tech.isActive && tech.deletedAt == null;
}