import type { Metadata } from 'next';
import { CustomerAppointmentPortal } from '@/components/hub/CustomerAppointmentPortal';

export const metadata: Metadata = {
  title: 'Your Appointment',
  description: 'Secure appointment details from your dealership.',
  robots: { index: false, follow: false },
};

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CustomerAppointmentPortal token={token} />;
}
