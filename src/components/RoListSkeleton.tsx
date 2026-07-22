'use client';

/** Consistent loading skeleton for bay RO list (tablet first paint). */
export function RoListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading repair orders">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="benz-card p-4 animate-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="h-4 w-28 rounded bg-benz-border/50 mb-3" />
          <div className="h-3 w-3/4 max-w-[240px] rounded bg-benz-border/40 mb-2" />
          <div className="h-3 w-1/2 max-w-[160px] rounded bg-benz-border/30" />
        </div>
      ))}
    </div>
  );
}
