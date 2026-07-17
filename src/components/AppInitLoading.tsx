import { LoadingScreen } from '@/components/LoadingScreen';

/** Consistent full-screen loading state while the app shell initializes. */
export function AppInitLoading() {
  return (
    <LoadingScreen
      label="Starting Merlinus"
      sublabel="Loading warranty documentation tools…"
    />
  );
}