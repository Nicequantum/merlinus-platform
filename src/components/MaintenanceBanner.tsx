'use client';

import { useEffect, useState } from 'react';

export function MaintenanceBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { maintenance?: boolean };
        if (!cancelled) setActive(Boolean(data.maintenance));
      } catch {
        // ignore — offline banner handles connectivity
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!active) return null;

  return (
    <div className="benz-maintenance-banner" role="status" aria-live="polite">
      <strong>Maintenance mode</strong>
      <span> — AI story generation and scans are paused. Manual entry still works.</span>
    </div>
  );
}