'use client';

/** Lightweight SVG sparkline for owner dashboard trends (no chart library). */
export function OwnerSparkline({
  values,
  width = 120,
  height = 36,
  className = '',
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  const series = values.length > 0 ? values : [0];
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = Math.max(max - min, 1);
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = series
    .map((v, i) => {
      const x = pad + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
      const y = pad + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const last = series[series.length - 1] ?? 0;
  const first = series[0] ?? 0;
  const rising = last >= first;
  const stroke = rising ? 'var(--apex-cyan, #22d3ee)' : 'var(--apex-amber, #f59e0b)';

  return (
    <svg
      className={`apex-sparkline ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `Trend, ${series.length} days`}
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {series.length > 0 ? (
        <circle
          cx={pad + (series.length === 1 ? innerW / 2 : innerW)}
          cy={pad + innerH - ((last - min) / range) * innerH}
          r="2.25"
          fill={stroke}
        />
      ) : null}
    </svg>
  );
}

export function formatTrendPct(changePct: number | null | undefined): string {
  if (changePct === null || changePct === undefined) return 'n/a';
  if (changePct > 0) return `+${changePct}%`;
  if (changePct === 0) return '0%';
  return `${changePct}%`;
}
