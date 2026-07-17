/** Brand-neutral diagnostic workflow — parallel structure to Mercedes, no OEM tools. */
export const GENERIC_WORKFLOW_STEPS = [
  'Initial road test to verify the concern as documented by the technician (mileage in/out if provided)',
  'Source voltage check at the battery',
  'Install battery maintainer to support vehicle voltage',
  'Connect diagnostic equipment and perform initial system scan',
  'Focused diagnostic testing on relevant fault codes from the scan',
  'Technician findings and diagnostic conclusions',
  'Repairs performed',
  'Clear fault codes and perform post-repair system scan to verify no codes return',
  'Disconnect battery maintainer and diagnostic equipment',
  'Verification road test (typically 3–5 miles) to confirm the repair (mileage in/out if provided)',
] as const;

export const GENERIC_WORKFLOW_SUMMARY =
  'initial road test (mi in/out) → source voltage → battery maintainer → diagnostic system scan → focused tests on relevant DTCs → technician findings → repairs → clear codes + post-repair scan → disconnect equipment → verification drive (mi in/out)';
