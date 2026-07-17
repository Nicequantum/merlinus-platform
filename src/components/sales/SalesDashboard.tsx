'use client';

import {
  DepartmentRequestDashboard,
  type DepartmentRequestDashboardProps,
} from '@/components/department/DepartmentRequestDashboard';

type Props = Omit<DepartmentRequestDashboardProps, 'department'>;

/** PR-M8 — Sales inbox (shared DepartmentRequest shell). */
export function SalesDashboard(props: Props) {
  return <DepartmentRequestDashboard department="sales" {...props} />;
}
