'use client';

import {
  DepartmentRequestDashboard,
  type DepartmentRequestDashboardProps,
} from '@/components/department/DepartmentRequestDashboard';

type Props = Omit<DepartmentRequestDashboardProps, 'department'>;

/** PR-M8 — Service inbox (shared DepartmentRequest shell). */
export function ServiceDashboard(props: Props) {
  return <DepartmentRequestDashboard department="service" {...props} />;
}
