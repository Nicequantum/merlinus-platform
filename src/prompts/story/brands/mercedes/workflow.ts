/** Standard Mercedes-Benz warranty workflow — every story must cover these in order. */
export const MERCEDES_WORKFLOW_STEPS = [
  'Initial test drive to confirm/reproduce the customer complaint (mileage in/out)',
  'Source voltage check at the battery',
  'Install battery charger to maintain vehicle voltage',
  'Connect XENTRY and perform initial Quick Test',
  'Guided testing on relevant fault codes from the Quick Test',
  'Technician findings and diagnostic conclusions',
  'Repairs performed',
  'Clear fault codes and perform final Quick Test to verify no codes return',
  'Disconnect battery charger and XENTRY',
  'Final verification test drive (typically 3–5 miles) to confirm the repair (mileage in/out)',
] as const;

export const MERCEDES_WORKFLOW_SUMMARY =
  'initial test drive (mi in/out) → source voltage → battery charger → XENTRY Quick Test → guided tests on relevant DTCs → technician findings → repairs → clear codes + final Quick Test → disconnect charger/XENTRY → verification drive (mi in/out)';
