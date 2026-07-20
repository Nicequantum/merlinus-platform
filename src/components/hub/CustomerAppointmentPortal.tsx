'use client';

import { useEffect, useState } from 'react';

type PortalPayload = {
  dealershipName: string;
  title: string;
  categoryLabel: string;
  statusLabel: string;
  startsAt: string;
  endsAt: string | null;
  vehicleLabel: string | null;
  advisorName: string | null;
  customerName: string | null;
  notes: string | null;
};

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function CustomerAppointmentPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/hub/appointment/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => ({}))) as PortalPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || 'This appointment link is not available.');
        setData(body);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load appointment');
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0f14] px-6">
        <p className="text-sm text-slate-300">Preparing your appointment details…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0f14] px-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-8 text-center">
          <p className="text-sm text-amber-200/90">{error || 'Not available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0c0f14] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-amber-600/10 blur-3xl" />
      </div>
      <header className="relative border-b border-white/10 bg-black/30 backdrop-blur-md">
        <div className="mx-auto max-w-lg px-5 py-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-500/90">
            {data.dealershipName}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Your appointment</h1>
        </div>
      </header>
      <main className="relative mx-auto max-w-lg px-5 py-8">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white to-slate-50 p-6 text-slate-900 shadow-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
            {data.categoryLabel} · {data.statusLabel}
          </p>
          <h2 className="mt-2 text-xl font-semibold">{data.title}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{formatWhen(data.startsAt)}</p>
          {data.customerName ? (
            <p className="mt-4 text-sm text-slate-600">For {data.customerName}</p>
          ) : null}
          {data.vehicleLabel ? (
            <p className="mt-1 text-sm text-slate-600">Vehicle: {data.vehicleLabel}</p>
          ) : null}
          {data.advisorName ? (
            <p className="mt-1 text-sm text-slate-600">Advisor: {data.advisorName}</p>
          ) : null}
          {data.notes ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.notes}</p>
            </div>
          ) : null}
          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            Questions? Contact the service department at {data.dealershipName}.
          </p>
        </div>
      </main>
    </div>
  );
}
