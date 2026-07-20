import Link from 'next/link';
import type { ReactNode } from 'react';

type LegalPageProps = {
  title: string;
  lastUpdated: string;
  children: ReactNode;
  siblingHref: string;
  siblingLabel: string;
};

/**
 * Public, customer-facing legal layout — calm, dealership-grade, easy to scan.
 */
export function LegalPage({ title, lastUpdated, children, siblingHref, siblingLabel }: LegalPageProps) {
  return (
    <div className="min-h-dvh bg-[#0c0f14] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-amber-600/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-slate-600/15 blur-3xl" />
      </div>

      <header className="relative border-b border-white/10 bg-black/30 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-500/90">
            Customer information
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
          <p className="text-sm text-slate-400">Last updated {lastUpdated}</p>
        </div>
      </header>

      <main className="relative mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-12">
        <article className="rounded-2xl border border-white/10 bg-gradient-to-b from-white to-slate-50 p-6 text-slate-800 shadow-2xl shadow-black/30 sm:p-10">
          <div className="legal-prose space-y-6 text-[15px] leading-relaxed text-slate-700">{children}</div>
        </article>

        <nav className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm">
          <Link
            href={siblingHref}
            className="font-medium text-amber-400/90 underline-offset-4 transition hover:text-amber-300 hover:underline"
          >
            {siblingLabel}
          </Link>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Secure customer services</p>
        </nav>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {title}
      </h2>
      <div className="space-y-3 text-slate-700">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600/80" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
