'use client';

import { useCallback, useEffect, useState } from 'react';

type ViewerPayload = {
  title: string;
  vehicleLabel: string | null;
  dealershipName: string | null;
  report: string;
  mediaUrl: string;
  createdAt: string;
};

export function VideoCustomerViewer({ token }: { token: string }) {
  const [data, setData] = useState<ViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (code?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/video/${encodeURIComponent(token)}`, {
          headers: code ? { 'x-video-passcode': code } : undefined,
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => ({}))) as ViewerPayload & {
          requiresPasscode?: boolean;
          error?: string;
          dealershipName?: string | null;
        };
        if (res.status === 401 && body.requiresPasscode) {
          setRequiresPasscode(true);
          setData(null);
          return;
        }
        if (!res.ok) {
          throw new Error(body.error || 'This link is invalid or has expired.');
        }
        setRequiresPasscode(false);
        setData(body as ViewerPayload);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load inspection');
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950 text-slate-200 p-6">
        <p>Loading your inspection…</p>
      </div>
    );
  }

  if (requiresPasscode) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950 text-slate-100 p-6">
        <form
          className="w-full max-w-sm space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void load(passcode);
          }}
        >
          <h1 className="text-lg font-semibold">Enter passcode</h1>
          <p className="text-sm text-slate-400">This inspection is passcode protected.</p>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="off"
            required
          />
          <button type="submit" className="w-full rounded-lg bg-cyan-600 py-2 font-medium text-white">
            View report
          </button>
          {error ? <p className="text-sm text-amber-400">{error}</p> : null}
        </form>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950 text-slate-200 p-6">
        <p className="text-center text-amber-300">{error || 'Not found'}</p>
      </div>
    );
  }

  const mediaSrc = passcode
    ? `${data.mediaUrl}?t=${encodeURIComponent(token)}`
    : data.mediaUrl;

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-4 md:px-8">
        <p className="text-xs uppercase tracking-widest text-cyan-400">
          {data.dealershipName || 'Service inspection'}
        </p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">{data.title}</h1>
        {data.vehicleLabel ? (
          <p className="mt-1 text-sm text-slate-400">{data.vehicleLabel}</p>
        ) : null}
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-2 md:p-8">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
            <video
              className="aspect-video w-full"
              controls
              playsInline
              preload="metadata"
              src={
                passcode
                  ? undefined
                  : mediaSrc
              }
              // Passcode-protected media needs header; use blob fetch when passcode set
              ref={(el) => {
                if (!el || !passcode) return;
                void (async () => {
                  try {
                    const res = await fetch(data.mediaUrl, {
                      headers: { 'x-video-passcode': passcode },
                    });
                    if (!res.ok) return;
                    const blob = await res.blob();
                    el.src = URL.createObjectURL(blob);
                  } catch {
                    // ignore
                  }
                })();
              }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Streamed securely — no download required.
          </p>
        </section>

        <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/80 p-4 md:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-400">
            Inspection report
          </h2>
          {data.report?.trim() ? (
            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap leading-relaxed">
              {data.report}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Your written report will appear here once your service team finishes processing.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
