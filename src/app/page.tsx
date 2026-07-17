import HomePageClient from '@/components/HomePageClient';
import { getPlatformMode } from '@/lib/platformMode';

export default function HomePage() {
  return <HomePageClient platformMode={getPlatformMode()} />;
}