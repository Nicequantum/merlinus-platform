'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ViewerPayload = {
  title: string;
  vehicleLabel: string | null;
  dealershipName: string | null;
  report: string;
  mediaUrl: string;
  hasVideo?: boolean;
  contentType?: string;
  createdAt: string;
};

function formatInspectionDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Split markdown-ish report into sections for premium layout. */
function parseReportSections(report: string): Array<{ heading: string; body: string }> {
  const text = report.trim();
  if (!text) return [];
  const parts = text.split(/^##\s+/m).filter(Boolean);
  if (parts.length <= 1 && !text.startsWith('##')) {
    return [{ heading: 'Inspection report', body: text }];
  }
  return parts.map((block) => {
    const nl = block.indexOf('\n');
    if (nl === -1) return { heading: block.trim(), body: '' };
    return {
      heading: block.slice(0, nl).trim() || 'Details',
      body: block.slice(nl + 1).trim(),
    };
  });
}

function renderBody(body: string) {
  const lines = body.split('\n');
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-slate-700">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (/^[-*•]\s+/.test(t)) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600/80" />
              <p>{t.replace(/^[-*•]\s+/, '')}</p>
            </div>
          );
        }
        if (/^\d+\.\s+/.test(t)) {
          const num = t.match(/^(\d+)\./)?.[1] ?? '';
          return (
            <div key={i} className="flex gap-3 pl-1">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {num}
              </span>
              <p className="pt-0.5">{t.replace(/^\d+\.\s+/, '')}</p>
            </div>
          );
        }
        return (
          <p key={i} className="text-slate-700">
            {t}
          </p>
        );
      })}
    </div>
  );
}

export function VideoCustomerViewer({ token }: { token: string }) {
  const [data, setData] = useState<ViewerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);

  const load = useCallback(
    async (code?: string) => {
      setLoading(true);
      setError(null);
      setVideoError(null);
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

  const sections = useMemo(
    () => (data?.report ? parseReportSections(data.report) : []),
    [data?.report]
  );

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0f14] px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full border border-amber-500/40 bg-amber-500/10" />
          <p className="text-sm tracking-wide text-slate-300">Preparing your inspection report…</p>
        </div>
      </div>
    );
  }

  if (requiresPasscode) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0f14] px-6">
        <form
          className="w-full max-w-md space-y-5 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-8 shadow-2xl shadow-black/50"
          onSubmit={(e) => {
            e.preventDefault();
            void load(passcode);
          }}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-500/90">
              Secure access
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Enter passcode</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              This inspection is protected. Enter the passcode provided by your service advisor.
            </p>
          </div>
          <input
            type="password"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none ring-amber-500/0 transition focus:ring-2 focus:ring-amber-500/50"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="off"
            required
            placeholder="Passcode"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-900/30 transition hover:from-amber-500 hover:to-amber-400"
          >
            View report
          </button>
          {error ? <p className="text-center text-sm text-amber-300">{error}</p> : null}
        </form>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0c0f14] px-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-8 text-center">
          <p className="text-sm text-amber-200/90">{error || 'This inspection link is not available.'}</p>
        </div>
      </div>
    );
  }

  const mediaSrc = data.mediaUrl;
  const showVideo = data.hasVideo !== false;

  return (
    <div className="min-h-dvh bg-[#0c0f14] text-slate-100">
      {/* Ambient luxury background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-amber-600/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-slate-600/20 blur-3xl" />
      </div>

      <header className="relative border-b border-white/10 bg-black/30 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 md:flex-row md:items-end md:justify-between md:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-500/90">
              {data.dealershipName || 'Authorized service'}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              {data.title || 'Video inspection report'}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
              {data.vehicleLabel ? <span>{data.vehicleLabel}</span> : null}
              {data.createdAt ? <span>{formatInspectionDate(data.createdAt)}</span> : null}
            </div>
          </div>
          <div className="hidden h-px w-24 bg-gradient-to-r from-amber-500/80 to-transparent md:block" />
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-8 px-5 py-8 md:grid-cols-5 md:gap-10 md:px-8 md:py-12">
        {/* Video column */}
        <section className="md:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
            {showVideo ? (
              <video
                className="aspect-video w-full bg-black"
                controls
                playsInline
                preload="metadata"
                controlsList="nodownload"
                src={passcode ? undefined : mediaSrc}
                onError={() =>
                  setVideoError('Video could not be loaded. Refresh the page or contact the dealership.')
                }
                ref={(el) => {
                  if (!el || !passcode) return;
                  void (async () => {
                    try {
                      const res = await fetch(data.mediaUrl, {
                        headers: { 'x-video-passcode': passcode },
                      });
                      if (!res.ok) {
                        setVideoError('Video could not be loaded.');
                        return;
                      }
                      const blob = await res.blob();
                      el.src = URL.createObjectURL(blob);
                    } catch {
                      setVideoError('Video could not be loaded.');
                    }
                  })();
                }}
              />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-slate-950 p-8 text-center text-sm text-slate-400">
                Video is not available for this inspection.
              </div>
            )}
          </div>
          {videoError ? (
            <p className="mt-3 text-sm text-amber-300/90">{videoError}</p>
          ) : (
            <p className="mt-3 text-xs tracking-wide text-slate-500">
              Secure stream · For your review only · No app required
            </p>
          )}
        </section>

        {/* Report column */}
        <section className="md:col-span-2">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white to-slate-50 p-6 text-slate-900 shadow-2xl shadow-black/30 md:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Written report
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              What your technician found
            </h2>
            <div className="mt-6 space-y-6">
              {sections.length > 0 ? (
                sections.map((sec) => (
                  <div key={sec.heading}>
                    <h3 className="mb-2 border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {sec.heading}
                    </h3>
                    {renderBody(sec.body)}
                  </div>
                ))
              ) : (
                <p className="text-sm leading-relaxed text-slate-500">
                  Your written report will appear here once your service team finishes processing.
                  You can still watch the video walkthrough above.
                </p>
              )}
            </div>
            <div className="mt-8 border-t border-slate-200 pt-5">
              <p className="text-xs leading-relaxed text-slate-500">
                Prepared with care for you by{' '}
                <span className="font-medium text-slate-700">
                  {data.dealershipName || 'your service team'}
                </span>
                . Questions? Contact the service department referenced in your message.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-white/5 py-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-600">
          Confidential customer inspection
        </p>
      </footer>
    </div>
  );
}
