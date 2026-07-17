'use client';

import { WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const CONNECTIVITY_CHECK_TIMEOUT_MS = 4_000;

async function verifyServerReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch('/api/status', { cache: 'no-store', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const checkSeqRef = useRef(0);

  const syncConnectivity = useCallback(async (trigger: 'init' | 'online' | 'offline') => {
    const checkId = ++checkSeqRef.current;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true);
      return;
    }

    if (trigger === 'offline') {
      setOffline(true);
      return;
    }

    const reachable = await verifyServerReachable();
    if (checkId !== checkSeqRef.current) return;
    setOffline(!reachable);
  }, []);

  useEffect(() => {
    void syncConnectivity('init');

    const onOnline = () => void syncConnectivity('online');
    const onOffline = () => void syncConnectivity('offline');

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      checkSeqRef.current += 1;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncConnectivity]);

  if (!offline) return null;

  return (
    <div className="benz-offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden />
      <span>No network — typed notes are safe. Reconnect to generate stories or sync scans.</span>
    </div>
  );
}