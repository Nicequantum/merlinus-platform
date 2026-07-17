'use client';

import { useId } from 'react';

type ApexLogoMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ApexLogoMarkSize, string> = {
  xs: 'apex-logo-mark--xs',
  sm: 'apex-logo-mark--sm',
  md: 'apex-logo-mark--md',
  lg: 'apex-logo-mark--lg',
  xl: 'apex-logo-mark--xl',
};

interface ApexLogoMarkProps {
  size?: ApexLogoMarkSize;
  className?: string;
  title?: string;
  animated?: boolean;
}

/** Metallic silver "A" with circuit traces, gauge arc, and cyan glow. */
export function ApexLogoMark({ size = 'md', className, title, animated }: ApexLogoMarkProps) {
  const uid = useId().replace(/:/g, '');
  const labelled = Boolean(title);

  return (
    <div
      className={['apex-logo-mark', SIZE_CLASS[size], className].filter(Boolean).join(' ')}
      aria-hidden={labelled ? undefined : true}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        className={animated ? 'apex-logo-animated' : undefined}
        role={labelled ? 'img' : 'presentation'}
        aria-hidden={labelled ? undefined : true}
      >
        {title ? <title>{title}</title> : null}
        <defs>
          <linearGradient id={`apex-silver-${uid}`} x1="18%" y1="8%" x2="82%" y2="92%">
            <stop offset="0%" stopColor="#f4f6fa" />
            <stop offset="38%" stopColor="#c8cdd8" />
            <stop offset="72%" stopColor="#8b93a3" />
            <stop offset="100%" stopColor="#dfe3eb" />
          </linearGradient>
          <linearGradient id={`apex-cyan-${uid}`} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#0891b2" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0891b2" stopOpacity="0.2" />
          </linearGradient>
          <filter id={`apex-glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Gauge arc */}
        <path
          d="M 12 44 A 20 20 0 0 1 52 44"
          fill="none"
          stroke={`url(#apex-cyan-${uid})`}
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.75"
        />
        <line x1="32" y1="26" x2="32" y2="22" stroke="#22d3ee" strokeWidth="1" opacity="0.55" />
        <line x1="20" y1="40" x2="17" y2="42" stroke="#22d3ee" strokeWidth="0.8" opacity="0.4" />
        <line x1="44" y1="40" x2="47" y2="42" stroke="#22d3ee" strokeWidth="0.8" opacity="0.4" />

        {/* Circuit traces */}
        <path
          d="M 8 20 H 14 V 24 M 56 20 H 50 V 24 M 10 48 H 16 M 54 48 H 48"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="0.7"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="14" cy="24" r="1.2" fill="#22d3ee" opacity="0.5" />
        <circle cx="50" cy="24" r="1.2" fill="#22d3ee" opacity="0.5" />

        {/* Letter A */}
        <g filter={`url(#apex-glow-${uid})`}>
          <path
            d="M 32 14 L 48 46 H 40.5 L 37.2 38.5 H 26.8 L 23.5 46 H 16 L 32 14 Z M 29 33 H 35 L 32 26.5 Z"
            fill={`url(#apex-silver-${uid})`}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </g>

        {/* Inner gauge needle */}
        <line
          x1="32"
          y1="42"
          x2="32"
          y2="30"
          stroke="#22d3ee"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.65"
        />
        <circle cx="32" cy="42" r="1.5" fill="#22d3ee" opacity="0.8" />
      </svg>
    </div>
  );
}