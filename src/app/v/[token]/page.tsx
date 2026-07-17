import type { Metadata } from 'next';
import { VideoCustomerViewer } from '@/components/videoInspection/VideoCustomerViewer';

export const metadata: Metadata = {
  title: 'Video Inspection Report',
  robots: { index: false, follow: false },
};

export default async function VideoInspectionPublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <VideoCustomerViewer token={token} />;
}
